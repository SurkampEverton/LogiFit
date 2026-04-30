# Runbook — Disaster Recovery Drill (quarterly)

- **Status:** Esqueleto (Sprint 00 Faixa 3)
- **Quando:** trimestral, primeira segunda-feira do mês 1/4/7/10
- **Quem executa:** fundador (DPO interim) — sozinho até equipe nascer
- **Duração estimada:** 90-120 min
- **Quando o drill real fica útil:** Sprint 04+ (primeiro dado clínico em produção)

## Objetivo

Validar empiricamente RPO 24h / RTO 4h da regra 40 (ADR 0091): **derrubar VPS Oracle Vinhedo, recriar do zero via `infra/bootstrap-oracle.sh`, restaurar último backup do Cloudflare R2, validar smoke tests**. Documentar surpresas.

## Pré-requisitos

- VPS staging alternativo provisionado (Hetzner CX22 Helsinki ou Oracle Vinhedo distinto da prod)
- Credenciais R2 em GitHub Secrets (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET=logifit-backup` + `R2_ACCOUNT_ID`)
- Chave GPG de descriptografia (cópia offline em pen drive físico — regra 40)
- Smoke tests `pnpm test:smoke` (ADR 0090 §6)

## Sequência (90-120min)

### 1. Snapshot pré-drill (10min)

- [ ] Confirmar último backup `pg_dump.sql.gz.gpg` no R2 ≤24h
- [ ] Anotar timestamp do último commit em `main` (recovery point)
- [ ] Anotar contadores `audit_log` (linhas) e `system_alerts` (open) no banco prod

### 2. Provisionamento staging (30-40min)

- [ ] Disparar `infra/bootstrap-oracle.sh` no VPS staging (runbook: `bootstrap-oracle.md`)
- [ ] Validar Coolify acessível em `staging.logifit.com.br`
- [ ] Validar containers Postgres + Redis + MinIO + Caddy ativos
- [ ] Cronometrar — alvo ≤30min

### 3. Restauração de dados (30-40min)

- [ ] Baixar último backup do R2 via `scripts/restore-pg.sh` (runbook: `restore-pg.md`)
- [ ] Descriptografar com chave GPG offline
- [ ] `pg_restore` com `--clean --if-exists` no Postgres staging
- [ ] Validar `pnpm db:rls-check` verde (regra 1+2)
- [ ] Validar contagens `audit_log`/`system_alerts` ≈ snapshot pré-drill (tolerância 24h de delta)
- [ ] Cronometrar — alvo ≤60min total (provisão + restore = RTO 4h-buffer)

### 4. Smoke tests (10min)

- [ ] Subir Next.js no staging via Coolify deploy (`PLAYWRIGHT_BASE_URL=https://staging.logifit.com.br`)
- [ ] `pnpm test:smoke` em pipeline GHA manual
- [ ] Validar 10 esqueletos `smoke/` passam (ADR 0090 §6)

### 5. Verify hash chain (5min)

- [ ] Rodar `scripts/verify-audit-chain.ts` (Sprint 19+) — confirma `current_hash` da última linha bate com SHA-256(... || previous_hash) (regra 39)
- [ ] Sem quebras → ✓; quebra → severidade p0, parar drill, abrir incidente

### 6. Teardown e relato (15min)

- [ ] Derrubar VPS staging (`oci compute instance terminate ...`)
- [ ] Documentar findings em `docs/runbooks/dr-drill-history.md` (criar se não existir):
  - Timestamps medidos vs alvo
  - Surpresas / passos não documentados
  - Ações de remediação
- [ ] Criar issues GitHub para cada surpresa
- [ ] Commit do dr-drill-history.md

## Critérios de sucesso

- ✓ Provisão ≤30min
- ✓ Restore ≤60min total → RPO 24h e RTO ≤4h validados
- ✓ Smoke tests verdes
- ✓ Hash chain íntegra
- ✓ Findings documentados

## Falhas conhecidas a investigar (matriz p0/p1/p2)

A preencher após primeiro drill real (Sprint 04+).
