#!/usr/bin/env bash
# LogiFit — Backup LOCAL (Camada 1 — regra 40 parcial)
#
# COMPLEMENTA backup-r2.sh (Camada 2 off-site, futuro).
#
# O QUE FAZ
#   1. pg_dump da DB `logifit` → gz → /data/backups/postgres/
#   2. pg_dump da DB `glitchtip` → gz → /data/backups/postgres/
#   3. Retention 30 dias (purge dumps mais antigos)
#
# O QUE NÃO FAZ (e por quê)
#   - GPG encrypt: backup local fica no mesmo trust boundary que o DB
#     (mesmo VPS, mesmo disco). Encrypt aqui não adiciona defesa em
#     profundidade real. Encrypt fica reservado pra backup-r2.sh (off-site).
#   - MinIO/Coolify/lokistack: cópia local de dados já presentes localmente
#     não protege contra disco corrompido. Esses ficam pra backup-r2.sh.
#
# COBRE
#   ✅ DB corrupção (UPDATE acidental, schema migration ruim)
#   ✅ Rollback de feature (volta dump de antes do deploy)
#   ✅ DR drill rápido (10min restore vs 4h restore de R2)
#
# NÃO COBRE
#   ❌ VPS perdido (disco fora, Oracle conta suspensa, ransomware)
#   ❌ Off-site (regra 40 completa precisa backup-r2.sh)
#
# QUANDO RODA
#   - Cron diário 02:30 UTC (configurado em /etc/cron.d/logifit-backup-local)
#   - Manual: `sudo /usr/local/bin/logifit-backup-local.sh`
#
# RUNBOOK
#   docs/runbooks/backup-r2.md §"Camada 1 — local"

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/data/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATE_TAG=$(date -u +%Y-%m-%d_%H%M%S)
LOG_PREFIX="[backup-local $DATE_TAG]"

log() { echo "$LOG_PREFIX $*"; }
err() { echo "$LOG_PREFIX ERROR: $*" >&2; }

log "início — root=$BACKUP_ROOT retention=${RETENTION_DAYS}d"

mkdir -p "$BACKUP_ROOT/postgres"
chmod 700 "$BACKUP_ROOT"  # só root lê (defesa em profundidade)

# ===== Postgres dump — DB logifit =====
PG_CONTAINER=$(docker ps --filter "ancestor=pgvector/pgvector:pg17" --format "{{.Names}}" | head -1)
if [[ -z "$PG_CONTAINER" ]]; then
  err "container Postgres pgvector:pg17 não encontrado — abortando"
  exit 1
fi
log "Postgres container: $PG_CONTAINER"

OUT_LOGIFIT="$BACKUP_ROOT/postgres/logifit-${DATE_TAG}.pgdump.gz"
log "(1/2) pg_dump logifit → $OUT_LOGIFIT"
if docker exec "$PG_CONTAINER" pg_dump -U postgres -Fc --no-owner --no-acl logifit \
   | gzip -9 > "$OUT_LOGIFIT.tmp"; then
  mv "$OUT_LOGIFIT.tmp" "$OUT_LOGIFIT"
  chmod 600 "$OUT_LOGIFIT"
  log "  OK ($(stat -c '%s' "$OUT_LOGIFIT") bytes)"
else
  err "pg_dump logifit falhou"
  rm -f "$OUT_LOGIFIT.tmp"
  exit 2
fi

# ===== Postgres dump — DB glitchtip (se existir) =====
GT_PG_CONTAINER=$(docker ps --filter "name=postgres-lkji13" --format "{{.Names}}" | head -1)
if [[ -n "$GT_PG_CONTAINER" ]]; then
  OUT_GT="$BACKUP_ROOT/postgres/glitchtip-${DATE_TAG}.pgdump.gz"
  log "(2/2) pg_dump glitchtip → $OUT_GT"
  if docker exec "$GT_PG_CONTAINER" pg_dump -U glitchtip -Fc --no-owner --no-acl glitchtip \
     | gzip -9 > "$OUT_GT.tmp"; then
    mv "$OUT_GT.tmp" "$OUT_GT"
    chmod 600 "$OUT_GT"
    log "  OK ($(stat -c '%s' "$OUT_GT") bytes)"
  else
    err "pg_dump glitchtip falhou (continuando — não-fatal)"
    rm -f "$OUT_GT.tmp"
  fi
else
  log "(2/2) GlitchTip postgres não encontrado — pulando"
fi

# ===== Retention — purga dumps mais antigos que RETENTION_DAYS =====
log "purge dumps > ${RETENTION_DAYS} dias"
find "$BACKUP_ROOT/postgres" -name "*.pgdump.gz" -type f -mtime "+${RETENTION_DAYS}" -delete || true

# ===== Métricas =====
TOTAL_FILES=$(find "$BACKUP_ROOT/postgres" -type f -name "*.pgdump.gz" | wc -l)
TOTAL_BYTES=$(du -sb "$BACKUP_ROOT/postgres" | awk '{print $1}')
log "fim — $TOTAL_FILES dumps mantidos / $TOTAL_BYTES bytes total"
