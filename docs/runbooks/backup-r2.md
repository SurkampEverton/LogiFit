# Runbook — Backup em camadas (local + off-site R2)

> 2 camadas independentes implementando regra 40 + [ADR 0091](../decisions/0091-self-host-total-oracle-sp.md):
>
> | Camada | Script | Onde | Cobertura | Status |
> |---|---|---|---|---|
> | **1 — local** | [`infra/backup-local.sh`](../../infra/backup-local.sh) | `/data/backups/` no próprio VPS | DB corruption · query errada · rollback de feature · DR drill rápido (10min) | **🟢 ATIVA** desde 2026-05-12 (cron 02:30 UTC) |
> | **2 — off-site R2** | [`infra/backup-r2.sh`](../../infra/backup-r2.sh) + [`restore-r2.sh`](../../infra/restore-r2.sh) | Cloudflare R2 (cifrado GPG) | VPS perdido · disco corrompido · conta Oracle suspensa · ransomware | **🟡 PENDENTE** — aguarda fundador fornecer R2 token + par GPG |
>
> **Camada 1 sozinha NÃO atende regra 40** (não é off-site). Camada 2 fecha conformidade.

- **Quando usar:** primeira configuração (ativação Camada 2) · drift do ambiente (rotação de credentials, troca de bucket) · DR drill trimestral · recovery real
- **Severidade típica:** ativação P3 / drill P3 / recovery real P0
- **Tempo estimado:** ativação 20 min · drill 2-4h · recovery 1-4h (depende do volume)
- **Quem executa:** fundador (acesso Cloudflare account)
- **Última revisão:** 2026-05-11

## Pré-requisitos

- [ ] Acesso root ao VPS Oracle (chave `ssh-key-2026-05-06`)
- [ ] Acesso Cloudflare account (dashboard.cloudflare.com)
- [ ] Pen drive físico com par GPG (chave pública + privada armored) — chave canônica `backup@logifit.com.br`
- [ ] MFA recente (<15min) na conta Cloudflare — gate regra 43

## Camada 1 — backup local (ATIVA)

**Por que existe:** cobre ~80% dos cenários reais de DR (DB corruption, rollback, query errada) com latência baixa (restore em ~10min vs ~4h pra R2). Não substitui Camada 2 — complementa.

**Onde está:**
- Script: `/usr/local/bin/logifit-backup-local.sh` (instalado via `infra/backup-local.sh`)
- Cron: `/etc/cron.d/logifit-backup-local` (02:30 UTC diário)
- Dumps: `/data/backups/postgres/` (chmod 700 root-only)
- Logs: `journalctl -t logifit-backup-local`

**O que faz:**
1. `pg_dump -Fc` da DB `logifit` → gzip → `/data/backups/postgres/logifit-YYYY-MM-DD_HHMMSS.pgdump.gz`
2. `pg_dump -Fc` da DB `glitchtip` → gzip → `glitchtip-YYYY-MM-DD_HHMMSS.pgdump.gz`
3. Retention 30 dias (`find -mtime +30 -delete`)

**Validar agora:**
```bash
ssh -i ~/.ssh/ssh-key-2026-05-06.key ubuntu@157.151.31.227 \
  'sudo ls -lh /data/backups/postgres/ && sudo du -sh /data/backups/'
```

**Restore (camada 1):**
```bash
# 1. Listar dumps disponíveis
sudo ls -t /data/backups/postgres/

# 2. Restaurar dump específico num DB shadow (não destrutivo)
PG_CONTAINER=$(sudo docker ps --filter "ancestor=pgvector/pgvector:pg17" --format "{{.Names}}" | head -1)
DUMP_FILE=/data/backups/postgres/logifit-YYYY-MM-DD_HHMMSS.pgdump.gz

sudo zcat "$DUMP_FILE" | sudo docker exec -i "$PG_CONTAINER" sh -c '
  psql -U postgres -c "DROP DATABASE IF EXISTS logifit_restore;"
  psql -U postgres -c "CREATE DATABASE logifit_restore;"
  pg_restore -U postgres -d logifit_restore --no-owner --no-acl
'

# 3. Validar dados restaurados no shadow antes de promover
sudo docker exec "$PG_CONTAINER" psql -U postgres -d logifit_restore -c "SELECT count(*) FROM ..."

# 4. Promover (atômico)
sudo docker exec "$PG_CONTAINER" psql -U postgres -c "ALTER DATABASE logifit RENAME TO logifit_old;"
sudo docker exec "$PG_CONTAINER" psql -U postgres -c "ALTER DATABASE logifit_restore RENAME TO logifit;"

# 5. Restart containers que conectam
sudo docker restart wxff14za4mgyr0w5i3uqsq6q-* pgbouncer-sbd28p5y*
```

## Camada 2 — backup off-site R2 (visão geral)

## Visão geral do que é guardado (Camada 2 — R2)

| Componente | O que vai | Por que | Tamanho estimado MVP | Tamanho estimado Sprint 06+ |
|---|---|---|---|---|
| `postgres/logifit-*.pgdump.gz.gpg` | DB principal app (Drizzle schemas) | RPO 24h (regra 40) | 100 MB | 5-20 GB |
| `postgres/glitchtip-*.pgdump.gz.gpg` | Eventos erros app | telemetria reproduzível | 50 MB | 500 MB-2 GB |
| `minio/**` | rclone sync incremental dos 5 buckets | uploads críticos (laudos, evolução) | 10 MB | 50-200 GB |
| `coolify/coolify-*.tar.gz.gpg` | Metadata Coolify (sqlite + configs) | recriação rápida do orchestrator em DR | 100 MB | 100-300 MB |
| `lokistack/lokistack-configs-*.tar.gz` | Configs Loki/Grafana/Promtail | reprovisioning | 1 MB | 1 MB |

**Custo R2:** $0.015/GB-mês + zero egress fee. Estimativa MVP: ~$0.20/mês. Sprint 06+: ~$3-5/mês.

**Retention:** 30 dias hot na R2 (default). Pós-Sprint 04, considerar cold tier após 90 dias.

## Passos — Primeira ativação (ainda não rodou em prod)

### 1. Criar bucket R2 + token API (no Cloudflare Dashboard)

1.1. Login em https://dash.cloudflare.com com MFA recente.

1.2. Sidebar → **R2** → **Create bucket**:
   - Name: `logifit-backups-prod`
   - Location: `WNAM` (Western North America) ou `Automatic`
   - **Default encryption: ON** (R2 já criptografa SSE-256 server-side — additional layer)

1.3. Sidebar → **R2** → **Manage R2 API tokens** → **Create API token**:
   - Token name: `logifit-vps-backup`
   - Permissions: **Object Read & Write**
   - Specify buckets: `logifit-backups-prod` (não dar acesso a outros)
   - TTL: 1 ano (ativar rotação anual via runbook `rotate-secrets.md`)
   - **Copiar** `Access Key ID` + `Secret Access Key` + `S3 API endpoint` (formato `https://<account>.r2.cloudflarestorage.com`)

### 2. Gerar par GPG (se ainda não existe)

Em máquina local segura (não no VPS):

```bash
gpg --full-gen-key
# Tipo: RSA + RSA (default)
# Tamanho: 4096
# Validade: 2y (renovar antes de expirar)
# Nome: LogiFit Backup
# Email: backup@logifit.com.br
# Passphrase: forte (anotar em gerenciador de senhas pessoal — ex.: 1Password)

# Export pública (pra VPS)
gpg --armor --export backup@logifit.com.br > backup-public.asc

# Export privada (pra pen drive offline + GitHub Secrets criptografado)
gpg --armor --export-secret-keys backup@logifit.com.br > backup-private.asc
```

**Onde guardar a privada:**
- ✅ Pen drive físico em local seguro (cofre, gaveta trancada)
- ✅ GitHub Secrets `GPG_BACKUP_PRIVATE_KEY` (encrypted at rest)
- ❌ NUNCA no VPS (defesa em profundidade — se VPS for comprometido, atacante não tem chave pra decifrar backups)

### 3. SSH no VPS + setup

```bash
ssh -i ~/.ssh/ssh-key-2026-05-06.key ubuntu@157.151.31.227

# 3.1. Upgrade rclone (Apt version é antiga — v1.53)
sudo curl -fsSL https://rclone.org/install.sh | sudo bash
rclone version  # esperado: v1.68+

# 3.2. rclone config interactive
rclone config
# n) new remote
# name: r2
# Storage: 4 (Amazon S3 Compliant)
# Provider: 6 (Cloudflare R2)
# env_auth: 1 (false — vamos colar manual)
# access_key_id: <do passo 1.3>
# secret_access_key: <do passo 1.3>
# region: auto
# endpoint: https://<account>.r2.cloudflarestorage.com  (do passo 1.3)
# acl: private
# y) confirma

# Smoke test:
rclone ls r2:logifit-backups-prod  # deve retornar vazio (bucket recém-criado)

# 3.3. Setup /etc/logifit/backup.env
sudo mkdir -p /etc/logifit
sudo tee /etc/logifit/backup.env >/dev/null <<EOF
R2_BUCKET=logifit-backups-prod
GPG_RECIPIENT=backup@logifit.com.br
RETENTION_DAYS=30
RCLONE_REMOTE=r2
EOF
sudo chmod 600 /etc/logifit/backup.env

# 3.4. Importar chave GPG pública no keyring root
sudo bash -c 'gpg --import /tmp/backup-public.asc'
# upload da pública via scp:
#   scp -i ~/.ssh/... backup-public.asc ubuntu@157.151.31.227:/tmp/

# 3.5. Trust=ultimate na chave pública (necessário pra non-interactive encrypt)
sudo gpg --command-fd 0 --edit-key backup@logifit.com.br <<EOF
trust
5
y
quit
EOF

# 3.6. Copia scripts pro path canônico
sudo cp /tmp/backup-r2.sh /usr/local/bin/logifit-backup-r2.sh
sudo cp /tmp/restore-r2.sh /usr/local/bin/logifit-restore-r2.sh
sudo chmod +x /usr/local/bin/logifit-*-r2.sh

# 3.7. Cria cron diário (03:00 UTC = 00:00 BRT — fora do pico)
sudo tee /etc/cron.d/logifit-backup-r2 >/dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
0 3 * * * root /usr/local/bin/logifit-backup-r2.sh 2>&1 | logger -t logifit-backup
EOF
sudo chmod 644 /etc/cron.d/logifit-backup-r2
```

### 4. Validar (smoke test)

```bash
# Roda manualmente 1× pra confirmar fluxo end-to-end
sudo /usr/local/bin/logifit-backup-r2.sh

# Esperado: 4 uploads (postgres logifit + postgres glitchtip + minio sync + coolify metadata + lokistack configs)

# Verifica no R2:
rclone ls r2:logifit-backups-prod | head -10

# Logs do cron (depois da próxima execução):
sudo journalctl -t logifit-backup -n 50
```

### 5. Setup DR drill trimestral (regra 40)

Adicionar entry em `docs/runbooks/dr-drill.md` referenciando este script. Primeiro drill real é Sprint 04+ (quando há dado de verdade).

## Passos — Restore (recovery real)

### Cenário: DB `logifit` corrompido

```bash
ssh -i ~/.ssh/ssh-key-2026-05-06.key ubuntu@157.151.31.227

# 1. Listar backups disponíveis
sudo /usr/local/bin/logifit-restore-r2.sh list

# 2. Restaurar último (cria DB 'logifit_restore' separado pra validar)
sudo /usr/local/bin/logifit-restore-r2.sh postgres-logifit

# 3. Validar dados restaurados em logifit_restore antes de promover
# (smoke tests, counts, etc.)

# 4. Promover (script imprime os comandos exatos pós-restore)
docker exec <pg_container> psql -U postgres -c "ALTER DATABASE logifit RENAME TO logifit_old;"
docker exec <pg_container> psql -U postgres -c "ALTER DATABASE logifit_restore RENAME TO logifit;"

# 5. Restart containers que conectam (app + pgbouncer)
sudo docker restart wxff14za4mgyr0w5i3uqsq6q-* pgbouncer-sbd28p5y*
```

### Cenário: MinIO upload bucket perdido

```bash
sudo /usr/local/bin/logifit-restore-r2.sh minio
# rclone sync R2 → volume local; pede confirmação porque sobrescreve

sudo docker restart minio-i7d3kdtafiu4zk67hx7mxjwr  # nome real do container MinIO
```

### Cenário: VPS perdido totalmente (DR completo)

1. Provisionar novo VPS Oracle Vinhedo via [`bootstrap-oracle.sh`](../../infra/bootstrap-oracle.sh)
2. Importar chave GPG privada do pen drive offline (`gpg --import backup-private.asc`)
3. Restaurar Coolify metadata → adapta para novo IP
4. Restaurar Postgres dumps via `logifit-restore-r2.sh postgres-logifit`
5. Restaurar MinIO via `logifit-restore-r2.sh minio`
6. Reapontar DNS Cloudflare A records pro novo IP
7. Validar smoke tests

**RTO target:** 4h (regra 40). DR drill trimestral confirma esse tempo.

## Rollback

Se `backup-r2.sh` falhar a meio caminho (network drop, rclone error):

- Backup parcial deixa objetos parciais no R2 com tag `${DATE_TAG}` específico — não corrompem backups anteriores
- Próxima execução cron (próximo dia 03:00 UTC) refaz tudo do zero — incremental sync via rclone

Se `restore-r2.sh` falhar a meio caminho:

- Database `logifit_restore` (não `logifit`) — banco original intocado
- Pode dropar e tentar de novo: `docker exec ... psql -c "DROP DATABASE logifit_restore;"`

## Monitoramento pós-execução

- [ ] Cron logs limpos: `sudo journalctl -t logifit-backup --since "1 day ago"` — sem `ERROR:`
- [ ] R2 bucket size crescendo monotonicamente (ou estável após retention purge)
- [ ] `rclone ls r2:$R2_BUCKET/postgres/ | wc -l` ≥ 30 após primeira semana de funcionamento
- [ ] Sprint 04+: alerta GlitchTip se backup falhar (cron exit code != 0)

## Em caso de falha

| Sintoma | Causa provável | Ação |
|---|---|---|
| `rclone: command not found` | apt rclone não instalado | `sudo curl -fsSL https://rclone.org/install.sh \| sudo bash` |
| `gpg: skipped: No public key` | chave pública não importada | `sudo gpg --import /tmp/backup-public.asc` + trust=ultimate |
| `gpg: ... trust model` warnings | trust não setado | step 3.5 do setup |
| `R2: 403 InvalidAccessKeyId` | token expirou ou rotação | regenerar token (passo 1.3) + `rclone config update r2` |
| `pg_dump: connection refused` | container Postgres parado | `docker start <pg_container>` + retry |
| `tar: /data/coolify: Cannot stat` | path Coolify mudou | atualizar script com path correto |

## Referências

- [ADR 0091 §Backup off-site](../decisions/0091-self-host-total-oracle-sp.md)
- [rules.md regra 40](../rules.md#regra-40-backup-off-site-cifrado--teste-de-restauração-trimestral--dr-plan-documentado)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [`infra/backup-r2.sh`](../../infra/backup-r2.sh)
- [`infra/restore-r2.sh`](../../infra/restore-r2.sh)
- [`docs/runbooks/dr-drill.md`](dr-drill.md) — drill trimestral
- [`docs/runbooks/restore-pg.md`](restore-pg.md) — restore específico Postgres
- [`docs/runbooks/rotate-secrets.md`](rotate-secrets.md) — rotação anual token R2 + GPG
