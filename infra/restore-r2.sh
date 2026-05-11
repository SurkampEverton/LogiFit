#!/usr/bin/env bash
# LogiFit — Restore de backup R2 (regra 40 + ADR 0091)
#
# COMPLEMENTO de backup-r2.sh — usado em DR drill trimestral (regra 40)
# ou em recovery real (Postgres corrompido, VPS perdido, etc.).
#
# USO
#   sudo /usr/local/bin/logifit-restore-r2.sh <COMPONENT> [BACKUP_DATE_TAG]
#
#   COMPONENT: postgres-logifit | postgres-glitchtip | minio | coolify | lokistack | list
#   BACKUP_DATE_TAG: YYYY-MM-DD_HHMMSS (opcional — default = mais recente)
#
# EXEMPLOS
#   # listar tudo
#   sudo /usr/local/bin/logifit-restore-r2.sh list
#
#   # restaurar último Postgres logifit
#   sudo /usr/local/bin/logifit-restore-r2.sh postgres-logifit
#
#   # restaurar Postgres de data específica
#   sudo /usr/local/bin/logifit-restore-r2.sh postgres-logifit 2026-05-10_030000
#
# PRÉ-REQUISITOS
#   - rclone configurado (mesmo do backup-r2.sh)
#   - GPG private key importada no keyring root (NÃO está no script — vem do pen drive offline)
#   - /etc/logifit/backup.env com R2_BUCKET, GPG_RECIPIENT
#
# RUNBOOK
#   docs/runbooks/backup-r2.md §"Restore"

set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/etc/logifit/backup.env}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

: "${R2_BUCKET:?R2_BUCKET não definido}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"

COMPONENT="${1:-list}"
DATE_TAG="${2:-}"

list_backups() {
  echo "=== Backups disponíveis em $RCLONE_REMOTE:$R2_BUCKET ==="
  for prefix in postgres minio coolify lokistack; do
    echo "--- $prefix ---"
    rclone ls "$RCLONE_REMOTE:$R2_BUCKET/$prefix/" 2>/dev/null | sort -k2 -r | head -10 || echo "  (vazio)"
  done
}

pick_latest() {
  local prefix="$1"
  local pattern="$2"
  rclone ls "$RCLONE_REMOTE:$R2_BUCKET/$prefix/" 2>/dev/null \
    | grep "$pattern" \
    | sort -k2 -r \
    | head -1 \
    | awk '{print $2}'
}

case "$COMPONENT" in
  list)
    list_backups
    ;;
  postgres-logifit)
    PG_CONTAINER=$(docker ps --filter "ancestor=pgvector/pgvector:pg17" --format "{{.Names}}" | head -1)
    [[ -z "$PG_CONTAINER" ]] && { echo "Postgres container não encontrado"; exit 1; }

    if [[ -z "$DATE_TAG" ]]; then
      FILE=$(pick_latest postgres "logifit-.*\.pgdump\.gz\.gpg$")
    else
      FILE="logifit-${DATE_TAG}.pgdump.gz.gpg"
    fi
    [[ -z "$FILE" ]] && { echo "nenhum backup logifit encontrado"; exit 1; }

    echo "Restaurando $FILE → $PG_CONTAINER:logifit"
    echo "ATENÇÃO: vai DROP+RECREATE database 'logifit'. Confirme com 'yes' em 10s:"
    read -t 10 -r CONFIRM
    [[ "$CONFIRM" != "yes" ]] && { echo "abortado"; exit 1; }

    rclone cat "$RCLONE_REMOTE:$R2_BUCKET/postgres/$FILE" \
      | gpg --decrypt \
      | gunzip \
      | docker exec -i "$PG_CONTAINER" sh -c '
          psql -U postgres -c "DROP DATABASE IF EXISTS logifit_restore;"
          psql -U postgres -c "CREATE DATABASE logifit_restore;"
          pg_restore -U postgres -d logifit_restore --no-owner --no-acl
        '
    echo "Restaurado em DB 'logifit_restore'. Pra ativar:"
    echo "  docker exec $PG_CONTAINER psql -U postgres -c 'ALTER DATABASE logifit RENAME TO logifit_old;'"
    echo "  docker exec $PG_CONTAINER psql -U postgres -c 'ALTER DATABASE logifit_restore RENAME TO logifit;'"
    ;;
  postgres-glitchtip)
    GT_PG=$(docker ps --filter "name=postgres-lkji13" --format "{{.Names}}" | head -1)
    [[ -z "$GT_PG" ]] && { echo "GlitchTip Postgres não encontrado"; exit 1; }
    if [[ -z "$DATE_TAG" ]]; then
      FILE=$(pick_latest postgres "glitchtip-.*\.pgdump\.gz\.gpg$")
    else
      FILE="glitchtip-${DATE_TAG}.pgdump.gz.gpg"
    fi
    [[ -z "$FILE" ]] && { echo "nenhum backup glitchtip encontrado"; exit 1; }
    echo "Restaurando $FILE → $GT_PG:glitchtip_restore"
    rclone cat "$RCLONE_REMOTE:$R2_BUCKET/postgres/$FILE" \
      | gpg --decrypt \
      | gunzip \
      | docker exec -i "$GT_PG" sh -c '
          psql -U glitchtip -c "DROP DATABASE IF EXISTS glitchtip_restore;" postgres
          psql -U glitchtip -c "CREATE DATABASE glitchtip_restore;" postgres
          pg_restore -U glitchtip -d glitchtip_restore --no-owner --no-acl
        '
    ;;
  minio)
    echo "Restore MinIO via rclone sync R2 → local volume"
    echo "ATENÇÃO: vai SOBRESCREVER volume MinIO local. Confirme 'yes' em 10s:"
    read -t 10 -r CONFIRM
    [[ "$CONFIRM" != "yes" ]] && { echo "abortado"; exit 1; }

    MINIO_VOLUME=$(docker volume ls --format "{{.Name}}" | grep -i "minio-data" | head -1)
    MINIO_PATH=$(docker volume inspect "$MINIO_VOLUME" --format "{{.Mountpoint}}")
    rclone sync "$RCLONE_REMOTE:$R2_BUCKET/minio/" "$MINIO_PATH/" \
      --transfers=4 \
      --skip-links
    echo "Restaurado. Reiniciar container MinIO recomendado:"
    echo "  docker restart \$(docker ps --filter 'name=minio-' -q | head -1)"
    ;;
  coolify)
    echo "Coolify metadata restore — extrai pra /tmp pra inspeção manual"
    if [[ -z "$DATE_TAG" ]]; then
      FILE=$(pick_latest coolify "coolify-.*\.tar\.gz\.gpg$")
    else
      FILE="coolify-${DATE_TAG}.tar.gz.gpg"
    fi
    rclone cat "$RCLONE_REMOTE:$R2_BUCKET/coolify/$FILE" \
      | gpg --decrypt \
      > /tmp/coolify-restore.tar.gz
    mkdir -p /tmp/coolify-restore
    tar -xzf /tmp/coolify-restore.tar.gz -C /tmp/coolify-restore
    echo "Extraído em /tmp/coolify-restore/ — inspecionar antes de aplicar manualmente"
    ;;
  lokistack)
    FILE=$(pick_latest lokistack "lokistack-configs-.*\.tar\.gz$")
    rclone cat "$RCLONE_REMOTE:$R2_BUCKET/lokistack/$FILE" \
      > /tmp/lokistack-restore.tar.gz
    echo "Baixado em /tmp/lokistack-restore.tar.gz — extrair pra /data/lokistack/ se necessário"
    ;;
  *)
    echo "Uso: $0 <postgres-logifit|postgres-glitchtip|minio|coolify|lokistack|list> [DATE_TAG]"
    exit 1
    ;;
esac
