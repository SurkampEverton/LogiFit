# Runbook — Operações comuns no Coolify

- **Status:** Esqueleto (Sprint 00 Faixa 2 vai expandir)
- **Quando consultar:** dúvidas operacionais com a stack self-host Oracle Vinhedo
- **Pré-requisitos:** Coolify rodando em `coolify.logifit.com.br` com auth (basic + IP whitelist)

## Cheatsheet rápido

| Tarefa | Caminho |
|---|---|
| Ver logs de container | Coolify UI → Application → Logs (tail real-time) |
| Restart container | UI → Application → Actions → Restart |
| Backup manual de volume | `scripts/backup-now.sh <volume-name>` (Faixa 3) |
| Inspecionar volume PG | SSH no VPS → `docker exec -it logifit-postgres bash` |
| Atualizar imagem após push GHCR | UI → webhook → "Trigger deployment now" |
| Var de ambiente de prod | UI → Application → Environment Variables |

## Operações comuns (links pra runbooks dedicados)

- [`bootstrap-oracle.md`](bootstrap-oracle.md) — primeira vez, criar conta + provisionar VPS + instalar Coolify
- [`restore-pg.md`](restore-pg.md) — restore de Postgres a partir de `pg_dump.sql.gz.gpg`
- [`restore-test.md`](restore-test.md) — teste de restore trimestral
- [`dr-drill.md`](dr-drill.md) — disaster recovery drill quarterly
- [`rotate-secrets.md`](rotate-secrets.md) — rotação de chaves (auth, GPG backup, Asaas, etc.)
- [`oracle-cutover-rollback.md`](oracle-cutover-rollback.md) — rollback do bootstrap se algo quebrar

## Troubleshooting comum

(seção a expandir conforme incidentes reais aparecerem — Sprint 04+)

### `Coolify "build failed"` após push GHCR

- Verificar tag da imagem: `docker pull ghcr.io/logifit/web:<sha>` direto da máquina dev
- Verificar webhook secret bate
- Coolify UI → Application → Build logs (linha do erro)
- Reverter para imagem anterior: UI → Deployments → Rollback

### Postgres `out of shared memory` em volume cheio

- `df -h /data` no VPS — block storage Oracle 200GB
- Reduzir partições históricas com `pg_partman` (regra 34) ou expandir volume

### Caddy SSL renovação falhou

- Caddy logs no Coolify → procurar "ACME challenge failed"
- Confirmar Cloudflare API token vivo (DNS-01 challenge)
- Forçar renovação: `coolify app:caddy:reload`

## Quando ligar pro DPO

(N/A no MVP solo — DPO é o fundador)
