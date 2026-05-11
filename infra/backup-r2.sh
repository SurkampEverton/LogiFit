#!/usr/bin/env bash
# LogiFit — Backup off-site Cloudflare R2 (regra 40 + ADR 0091)
#
# O QUE FAZ
#   1. pg_dump da DB `logifit` (app) + DB `glitchtip` (errors) — gzip + GPG encrypt
#   2. Snapshot do MinIO data dir (rclone sync incremental, criptografia em trânsito)
#   3. Coolify metadata (sqlite + configs em /data/coolify/source/)
#   4. Upload pro bucket R2 — chaves: postgres/, minio/, coolify/, lokistack/
#   5. Retention: 30 dias na R2 (rclone purge antigos)
#
# QUANDO RODA
#   - Cron diário 03:00 UTC (configurado em /etc/cron.d/logifit-backup-r2)
#   - Manual: `sudo /usr/local/bin/logifit-backup-r2.sh`
#
# PRÉ-REQUISITOS
#   - rclone configurado: `~/.config/rclone/rclone.conf` com remote `r2`
#       (provider=Cloudflare, access_key_id, secret_access_key, endpoint=https://<account>.r2.cloudflarestorage.com)
#   - GPG public key importada no keyring root: `gpg --import /etc/logifit/backup-public.asc`
#       (recipient: backup@logifit.com.br — chave privada em pen drive offline + GitHub Secrets)
#   - Variável R2_BUCKET setada em /etc/logifit/backup.env
#   - Variável GPG_RECIPIENT setada em /etc/logifit/backup.env
#
# SAÍDA
#   - stdout/stderr → journald (`journalctl -u logifit-backup-r2.service`)
#   - Sucesso silencioso (cron não emite mail); falha → exit code != 0 + journald error
#   - GlitchTip captura via cron + curl webhook (futuro Sprint 03)
#
# RUNBOOK
#   docs/runbooks/backup-r2.md

set -euo pipefail

# ===== Config =====
CONFIG_FILE="${CONFIG_FILE:-/etc/logifit/backup.env}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

: "${R2_BUCKET:?R2_BUCKET não definido — preencha /etc/logifit/backup.env}"
: "${GPG_RECIPIENT:?GPG_RECIPIENT não definido — preencha /etc/logifit/backup.env (ex.: backup@logifit.com.br)}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"

DATE_TAG=$(date -u +%Y-%m-%d_%H%M%S)
LOG_PREFIX="[backup-r2 $DATE_TAG]"

log() { echo "$LOG_PREFIX $*"; }
err() { echo "$LOG_PREFIX ERROR: $*" >&2; }

log "início — bucket=$R2_BUCKET retention=${RETENTION_DAYS}d"

# Localiza container Postgres do Coolify (UUID-based)
PG_CONTAINER=$(docker ps --filter "ancestor=pgvector/pgvector:pg17" --format "{{.Names}}" | head -1)
if [[ -z "$PG_CONTAINER" ]]; then
  err "container Postgres pgvector:pg17 não encontrado — abortando"
  exit 1
fi
log "Postgres container: $PG_CONTAINER"

# ===== 1) Postgres dump (DB: logifit) =====
log "(1/4) pg_dump logifit → encrypt → upload"
docker exec "$PG_CONTAINER" pg_dump -U postgres -Fc --no-owner --no-acl logifit \
  | gzip -9 \
  | gpg --encrypt --recipient "$GPG_RECIPIENT" --trust-model always --output - \
  | rclone rcat "$RCLONE_REMOTE:$R2_BUCKET/postgres/logifit-${DATE_TAG}.pgdump.gz.gpg"

# Localiza container Postgres do GlitchTip
GT_PG_CONTAINER=$(docker ps --filter "name=postgres-lkji13" --format "{{.Names}}" | head -1)
if [[ -n "$GT_PG_CONTAINER" ]]; then
  log "(1b/4) pg_dump glitchtip → encrypt → upload"
  docker exec "$GT_PG_CONTAINER" pg_dump -U glitchtip -Fc --no-owner --no-acl glitchtip \
    | gzip -9 \
    | gpg --encrypt --recipient "$GPG_RECIPIENT" --trust-model always --output - \
    | rclone rcat "$RCLONE_REMOTE:$R2_BUCKET/postgres/glitchtip-${DATE_TAG}.pgdump.gz.gpg"
else
  log "(1b/4) GlitchTip postgres não encontrado — pulando"
fi

# ===== 2) MinIO data dir =====
# MinIO já tem data versionado nos buckets (versioning=Enabled no bootstrap-buckets).
# Aqui replicamos para R2 como segunda camada (regra 40 — defesa em profundidade).
log "(2/4) MinIO data → rclone sync → R2 (incremental)"
MINIO_VOLUME=$(docker volume ls --format "{{.Name}}" | grep -i "minio-data" | head -1)
if [[ -n "$MINIO_VOLUME" ]]; then
  MINIO_PATH=$(docker volume inspect "$MINIO_VOLUME" --format "{{.Mountpoint}}")
  # rclone sync (não copy) pra refletir deletions; --transfers limita IO
  rclone sync "$MINIO_PATH" "$RCLONE_REMOTE:$R2_BUCKET/minio/" \
    --transfers=4 \
    --checkers=8 \
    --skip-links \
    --exclude ".minio.sys/buckets/.minio.sys/**"
else
  err "volume MinIO não encontrado — pulando"
fi

# ===== 3) Coolify metadata =====
# Backup do estado do Coolify (sqlite + configs gerados) — pra DR restaurar tudo
log "(3/4) Coolify metadata → tar → encrypt → upload"
if [[ -d /data/coolify ]]; then
  tar -czf - -C /data coolify 2>/dev/null \
    | gpg --encrypt --recipient "$GPG_RECIPIENT" --trust-model always --output - \
    | rclone rcat "$RCLONE_REMOTE:$R2_BUCKET/coolify/coolify-${DATE_TAG}.tar.gz.gpg"
else
  err "/data/coolify não existe — pulando"
fi

# ===== 4) Lokistack configs =====
log "(4/4) /data/lokistack → tar → upload (configs, sem dados — Loki/Grafana volumes ficam em Docker)"
if [[ -d /data/lokistack ]]; then
  tar -czf - -C /data lokistack \
    | rclone rcat "$RCLONE_REMOTE:$R2_BUCKET/lokistack/lokistack-configs-${DATE_TAG}.tar.gz"
fi

# ===== Retention — limpa backups > RETENTION_DAYS =====
log "purge backups com mais de ${RETENTION_DAYS} dias"
rclone delete "$RCLONE_REMOTE:$R2_BUCKET/" --min-age "${RETENTION_DAYS}d" --rmdirs || true

# ===== Métricas =====
TOTAL_OBJECTS=$(rclone size "$RCLONE_REMOTE:$R2_BUCKET/" --json 2>/dev/null | grep -oE '"count":[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "?")
TOTAL_BYTES=$(rclone size "$RCLONE_REMOTE:$R2_BUCKET/" --json 2>/dev/null | grep -oE '"bytes":[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "?")
log "fim — bucket size: $TOTAL_OBJECTS objects / $TOTAL_BYTES bytes"
