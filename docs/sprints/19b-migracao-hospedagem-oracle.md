# Sprint 19b — Migração de hospedagem: Vercel + Supabase → Vercel + Postgres no Oracle Cloud

- **Área:** infra
- **Início:** planejado (depois do Sprint 19 + MVP estável por 30d)
- **Fim planejado:** 1.5-2 semanas
- **Status:** planejado (futuro pós-MVP)
- **Item do roadmap:** #22

## Goal

Migrar a infra de banco/auth/storage/realtime de Supabase pra stack self-hosted no Oracle Cloud OCI (free tier vitalício 24GB/4 OCPU), mantendo Vercel como hospedagem do Next.js. Cutover em janela de manutenção planejada de 2-4h madrugada com rollback rehearsado. Zero data loss.

Esta migração estava planejada desde o início do projeto ([ADR 0078](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)) — Sprint 00 a 19 cravaram 8 regras de portabilidade pra que esta sprint seja **finita** (~60h trabalho, sem refactor de código de feature).

## Critério de aceite

- Postgres 17 rodando em Oracle Cloud OCI ARM Ampere com extensions necessárias (`pg_trgm`, `unaccent`, `pgvector`)
- PgBouncer configurado em transaction mode
- Backup automático diário cifrado com pgBackRest → Cloudflare R2; retenção 30d quente + 12m frio
- Auth migrada de Supabase Auth pra **BetterAuth** (escolhida sobre Lucia pela maturidade Next.js 15) — magic link + OAuth Google + TOTP MFA + recovery codes — todos os fluxos testados E2E
- Storage migrado de Supabase Storage pra Cloudflare R2 — interface `StorageAdapter` (Sprint 00) sem refactor; só pluga `R2StorageAdapter`
- Realtime migrado de Supabase Realtime pra **Postgres LISTEN/NOTIFY + ws.js** server-side rodando em Vercel Edge Runtime ou Node container Oracle (decidir no início da sprint)
- DNS apontando pra novo PG via `DATABASE_URL` env atualizada na Vercel
- Monitoring ativo (Better Stack ou Grafana Cloud free tier)
- **Zero data loss** confirmado: contagem de linhas em todas as tabelas + checksum SHA256 de algumas tabelas críticas (`audit_log`, `prontuarios`, `members`, `patient_company_links`, `financial_transactions`)
- **Hash chain do `audit_log` (regra 39) preservado** — última linha pré-cutover continua linkada com primeira pós-cutover
- **Audit anchor S3 Object Lock (regra 39)** mantém referência cross-cutover
- Smoke tests de 8 fluxos críticos passam pós-cutover (login, criar member, prescrição, agendamento, cobrança Asaas webhook, IA call, busca global, upload exame com scan)
- Rollback documentado e ensaiado em ambiente staging
- 30 dias de operação pós-cutover sem incidente P0/P1

## Dependências

- **Sprint 19 (MVP fechado)** — não migra durante MVP em curso
- **MVP estável por 30 dias** — sem incidente P0/P1 nos 30d anteriores
- **8 regras de portabilidade da ADR 0078 cumpridas** desde Sprint 00 — verificar pré-sprint que nada novo introduziu lock-in Supabase
- Conta Oracle Cloud criada + verified
- Conta Cloudflare R2 ativa (já provisionada Sprint 00)
- Domínio `logifit.com.br` controlado via Cloudflare DNS

## Decisões tomadas

- [ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md)
- Decisão pendente: **BetterAuth vs Lucia** — fechar no início da sprint via spike de 4h em ambos. Critérios: maturidade Next.js 15, suporte TOTP MFA, recovery codes, magic link, OAuth, hooks pra custom claims (`tenant_id`, `group_ids`, `topology`).
- Decisão pendente: **WebSocket onde rodar** — Vercel Edge Runtime tem limitações de long-lived connections; alternativa Node container no próprio Oracle (mesma VM do PG, separado por porta). Spike 2h.

## Fases da migração (7 fases + monitoring final)

### Fase 1 — Provisionamento Oracle Cloud (4h)

- [ ] Criar conta OCI + verificar (cartão de crédito necessário pra verify, NÃO é cobrado em free tier vitalício)
- [ ] Provisionar VM ARM Ampere A1: 4 OCPU + 24GB RAM + 200GB block storage (free tier vitalício)
- [ ] Configurar região: **São Paulo (sa-saopaulo-1)** — minimiza latência Vercel→Oracle
- [ ] Setup OS: Ubuntu 22.04 LTS ARM
- [ ] Firewall (Security List + iptables): liberar 22 (SSH com key only) + 6432 (PgBouncer com SSL) + 443 (Caddy/nginx pra realtime ws); fechar todo o resto
- [ ] DNS interno: `pg.logifit.com.br` (CNAME apontando pra Oracle public IP) — via Cloudflare proxy
- [ ] Snapshot inicial da VM (rollback caso setup quebre)

### Fase 2 — Setup Postgres 17 + PgBouncer + SSL (8h)

- [ ] Instalar Postgres 17 via apt (`postgresql-17`) ou compilar otimizado pra ARM
- [ ] Tuning inicial via `pgtune` para 24GB RAM + ARM:
  - `shared_buffers = 6GB`
  - `effective_cache_size = 18GB`
  - `work_mem = 32MB`
  - `maintenance_work_mem = 1.5GB`
  - `wal_buffers = 16MB`
  - `max_connections = 200` (pooler vai limitar de fato)
  - `max_parallel_workers = 4`
- [ ] Habilitar extensions: `CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent; CREATE EXTENSION pgvector; CREATE EXTENSION pg_stat_statements;`
- [ ] Criar role `logifit_app` (CRUD em schemas LogiFit) + role `logifit_readonly` (read replicas futuras) + role `logifit_migrator` (DDL via Drizzle)
- [ ] Setup PgBouncer em **transaction mode** — porta 6432 — `max_client_conn=2000` `default_pool_size=50`
- [ ] SSL obrigatório (`ssl=on` + cert Let's Encrypt via Caddy ou auto-cert OCI)
- [ ] Habilitar `pg_stat_statements` + log slow queries (>500ms)
- [ ] **Migrar schema** via Drizzle pointing to new connection: `DATABASE_URL=postgres://logifit_migrator:...@pg.logifit.com.br:6432/logifit pnpm db:migrate` — schema sobe limpo (estrutura sem dados)
- [ ] Validar que todas as tabelas + RLS policies + funções SQL + triggers + partições futuras criadas

### Fase 3 — Backup automático com pgBackRest → Cloudflare R2 (4h)

- [ ] Instalar `pgbackrest` na VM Oracle
- [ ] Configurar `/etc/pgbackrest/pgbackrest.conf`:
  - Repo S3-compatible apontando pra Cloudflare R2 bucket `logifit-pg-backup`
  - Retenção: 7 backups full + 30 dias incrementais
  - Cifragem: GPG com chave LogiFit (mesma `BACKUP_GPG_KEY` env já no Vercel — exportada pra Oracle env)
- [ ] Configurar cron: full backup semanal (domingo 03:00) + incremental diário (todo dia 03:00)
- [ ] Teste de restore em VM staging — runbook em `runbooks/restore-pg.md`
- [ ] Validar que backup chega em R2 + tamanho razoável + restore consegue rebuild PG

### Fase 4 — Substituir Supabase Auth por BetterAuth (15-20h)

- [ ] **Spike 4h:** comparar BetterAuth vs Lucia — fechar decisão
- [ ] Instalar BetterAuth (assumindo escolhida) com adapter Drizzle Postgres
- [ ] Schema BetterAuth: `users_auth`, `accounts`, `sessions`, `verification_tokens` — Drizzle migrations em `packages/db/schema/auth.ts`
- [ ] Migrar dados de auth: script `scripts/migrate-auth-from-supabase.ts` — lê `auth.users` Supabase + insere em `users_auth` BetterAuth (mantém `id` UUID pra preservar FKs em `users.auth_user_id`)
- [ ] Reimplementar handlers Server Actions em `apps/web/app/auth/actions.ts`:
  - `signInWithMagicLink(email)` — gera token + envia via Resend (mesmo provider de email que já usa)
  - `verifyMagicLink(token)` — valida + cria sessão BetterAuth + injeta cookie `logifit_session`
  - `signInWithGoogle()` — OAuth flow
  - `enableMFA()` — TOTP setup com QR code
  - `verifyMFA(code)` — durante login
  - `generateRecoveryCodes()` — 10 one-time codes
  - `signOut({ scope: 'this' | 'others' | 'all' })`
- [ ] **JWT custom claims** (`tenant_id`, `group_ids`, `topology`, `mfa`, `scopes[]`) injetados via BetterAuth hook após sucesso de login (substitui Supabase Auth Hook)
- [ ] Middleware `apps/web/middleware.ts` continua igual (já lê cookie próprio desde Sprint 01a — regra portabilidade ADR 0078 ✓)
- [ ] **Política de transição:** sessions Supabase ainda válidas no momento do cutover são honradas por janela de 24h via tabela `legacy_supabase_sessions` que o middleware consulta como fallback; após 24h, force re-login
- [ ] Testes E2E completos de auth nos 3 viewports

### Fase 5 — Substituir Supabase Storage por Cloudflare R2 (4h)

- [ ] Bucket R2 `logifit-uploads` (já provisionado Sprint 00 pra backup; criar separado)
- [ ] Implementar `R2StorageAdapter` em `packages/storage/r2-adapter.ts` (interface `StorageAdapter` já existe desde Sprint 00 — regra portabilidade ✓)
- [ ] Signed URLs próprias via AWS SDK S3-compatible (R2 expõe API S3) com TTL configurável
- [ ] Migrar arquivos: script `scripts/migrate-storage-from-supabase.ts` — lista buckets Supabase + baixa + sobe pra R2 + atualiza `*.storage_path` nas tabelas se path mudar; preserva metadata
- [ ] Update env: `STORAGE_PROVIDER=r2` + `R2_ACCESS_KEY` + `R2_SECRET_KEY` + `R2_BUCKET` + `R2_ENDPOINT`
- [ ] **`scanUpload()` (regra 38)** continua igual — adapter agnóstico

### Fase 6 — Substituir Supabase Realtime por LISTEN/NOTIFY + WebSocket (8h)

- [ ] Auditar uso de Supabase Realtime no código:
  - Quais canais? Quais clientes consomem? Quais tabelas escutam?
  - Volume estimado de mensagens/min
- [ ] **Decisão WebSocket:** spike 2h
  - Opção A: Vercel Edge Runtime (limitação connection longeva) → fica problemático
  - Opção B: Node container na própria VM Oracle (porta 443 atrás de Caddy SSL termination) → recomendada
- [ ] Implementar `apps/realtime/server.ts` Node container:
  - Escuta `LISTEN logifit_events` no Postgres
  - Recebe `NOTIFY logifit_events, '{"channel":"tenant:abc","event":"member.updated","payload":...}'` de triggers SQL
  - Faz fan-out via `ws.js` por canal subscrito
- [ ] Triggers SQL nas tabelas relevantes para `pg_notify('logifit_events', ...)` ao INSERT/UPDATE/DELETE
- [ ] Cliente Next.js: substitui `supabase.channel(...)` por `useLogifitRealtime(channel)` hook próprio
- [ ] systemd unit pra subir realtime server na VM Oracle + restart automático

### Fase 7 — Cutover (janela 2-4h madrugada planejada)

**Pré-cutover (D-7):**
- [ ] Anunciar manutenção pra todos tenants (email + banner in-app)
- [ ] Snapshot final Supabase (`pg_dump` cifrado salvo em R2)
- [ ] Backup hash chain anchor (regra 39 — última linha `system_audit_anchor` registrada)
- [ ] Rehearsal completo do cutover em ambiente staging Oracle
- [ ] Rollback plan revisado e cronometrado (RTO ≤ 30min)

**Cutover (D=0, 03:00 BRT):**
- [ ] **03:00** — Banner "modo manutenção" ON; bloquear writes via Vercel deploy de versão "read-only"
- [ ] **03:05** — `pg_dump --format=custom --jobs=4 supabase_db > final.dump` (estimar ~5-15min pra 5GB)
- [ ] **03:20** — `pg_restore --jobs=4 -d 'postgres://logifit_migrator:...@pg.logifit.com.br' final.dump` (estimar 10-20min)
- [ ] **03:40** — Validações:
  - Contagem de linhas por tabela = baseline
  - SHA256 de tabelas críticas
  - **Hash chain integridade**: rodar `verify-audit-integrity` job manualmente
  - Test query simples em cada schema
- [ ] **03:50** — Update env Vercel: `DATABASE_URL` aponta pra Oracle; `STORAGE_PROVIDER=r2`; `AUTH_PROVIDER=better_auth`
- [ ] **04:00** — Vercel deploy nova versão (sem flag manutenção, conectando ao Oracle)
- [ ] **04:10** — Smoke tests automatizados rodam (8 fluxos críticos)
- [ ] **04:30** — Banner manutenção OFF se smoke tests passaram; senão **rollback**

**Pós-cutover (D+1 a D+30):**
- [ ] Monitoring intensivo primeiras 72h: PG load, latência queries, erros Sentry, custo
- [ ] Sprint 19c (não-numerada): tuning fino do PG conforme observação dos primeiros 30d
- [ ] Decommissionar projeto Supabase após **30 dias estáveis** (mantém como backup vivo até lá)

### Monitoring final (4h)

- [ ] Better Stack ou Grafana Cloud apontando pra Oracle
- [ ] Dashboards: PG connections, slow queries, cache hit ratio, replication lag (futuro), backup success
- [ ] Alertas: load >80% por 10min, slow query >2s, falha de backup, disk >70%
- [ ] Integração com Sentry: PG errors propagam

## Server Actions + API Routes

Mudanças em `apps/web/`:

- `apps/web/app/auth/actions.ts` — reescrita com BetterAuth handlers (substitui Supabase Auth)
- `apps/realtime/` — novo Node container com LISTEN/NOTIFY + ws.js
- `packages/storage/r2-adapter.ts` — novo adapter
- `packages/db/connection.ts` — connection string lê de `DATABASE_URL` (já era assim — regra portabilidade ✓)

Nenhuma mudança em código de feature (Server Actions de modules como `members/actions.ts`, `treinos/actions.ts`, etc) graças às regras de portabilidade.

## Schemas Drizzle

Mudanças mínimas:

- `packages/db/schema/auth.ts` — schemas BetterAuth (`users_auth`, `accounts`, `sessions`, `verification_tokens`)
- `packages/db/schema/legacy.ts` — `legacy_supabase_sessions` (tabela transicional, dropada após 24h pós-cutover)

Schemas existentes **não mudam** — Postgres é Postgres.

## Eventos de domínio emitidos

Nenhum evento novo. Eventos existentes continuam, agora via PG `LISTEN/NOTIFY` em vez de Supabase Realtime.

## Commit (checklist)

**Fase 1 — Oracle setup:**

- [ ] VM ARM Ampere A1 24GB/4 OCPU provisionada em `sa-saopaulo-1`
- [ ] Firewall configurado (22, 6432, 443 only)
- [ ] Snapshot inicial salvo
- [ ] DNS `pg.logifit.com.br` apontando via Cloudflare proxy

**Fase 2 — Postgres + PgBouncer:**

- [ ] PostgreSQL 17 instalado + tunado pra 24GB ARM
- [ ] Extensions habilitadas: `pg_trgm`, `unaccent`, `pgvector`, `pg_stat_statements`
- [ ] Roles criados: `logifit_app`, `logifit_readonly`, `logifit_migrator`
- [ ] PgBouncer transaction mode + SSL ativo
- [ ] Schema migrado via Drizzle (DDL only, sem dados)

**Fase 3 — Backup pgBackRest:**

- [ ] pgBackRest instalado + config pra R2
- [ ] Cron full semanal + incremental diário
- [ ] Teste de restore em staging documentado

**Fase 4 — Auth (BetterAuth):**

- [ ] Spike BetterAuth vs Lucia decidido
- [ ] Schemas Drizzle BetterAuth aplicados
- [ ] Server Actions reescritas (signIn, verify, MFA, OAuth, signOut)
- [ ] JWT custom claims hook (`tenant_id`, `group_ids`, `topology`, `mfa`, `scopes[]`)
- [ ] `legacy_supabase_sessions` transição 24h
- [ ] Migração de dados auth (script `migrate-auth-from-supabase.ts`)
- [ ] Testes E2E auth completos 3 viewports

**Fase 5 — Storage R2:**

- [ ] Bucket R2 `logifit-uploads` criado
- [ ] `R2StorageAdapter` implementado em `packages/storage/`
- [ ] Migração de arquivos (script `migrate-storage-from-supabase.ts`)
- [ ] Env atualizadas: `STORAGE_PROVIDER=r2`
- [ ] `scanUpload()` continua funcionando agnóstico

**Fase 6 — Realtime LISTEN/NOTIFY:**

- [ ] Auditoria de uso Supabase Realtime feita
- [ ] Decisão WebSocket runtime (spike 2h)
- [ ] `apps/realtime/server.ts` Node container
- [ ] Triggers SQL `pg_notify` nas tabelas relevantes
- [ ] Hook `useLogifitRealtime(channel)` substitui `supabase.channel()`
- [ ] systemd unit + restart automático

**Fase 7 — Cutover:**

- [ ] Anúncio de manutenção D-7
- [ ] Snapshot final Supabase salvo em R2
- [ ] Rehearsal staging cronometrado (≤4h)
- [ ] Rollback plan revisado (RTO ≤30min)
- [ ] Cutover executado em janela 03:00-05:00 BRT
- [ ] Validações pós-restore: row count + checksums + hash chain integridade
- [ ] Smoke tests 8 fluxos pós-cutover
- [ ] Monitoring intensivo 72h

**Pós-cutover:**

- [ ] 30 dias sem P0/P1 documentados
- [ ] Decommission Supabase
- [ ] CHANGELOG atualizado
- [ ] Roadmap: Sprint 19b → done

## Stretch

- [ ] Read replica em Oracle (segunda VM free tier — 2 OCPU 12GB) pra reads pesados
- [ ] Patroni HA setup (futuro Fase 3)
- [ ] CDN front pra assets estáticos (Cloudflare já fica na frente)

## Plano de rollback

Se cutover falhar (smoke tests não passam OR PG indisponível OR perda de dados detectada):

| Ação | Tempo |
|---|---|
| Banner manutenção mantém ON | imediato |
| Reverter Vercel deploy pra versão pré-cutover | 2-3min |
| Reverter env: `DATABASE_URL` aponta pra Supabase + `STORAGE_PROVIDER=supabase` + `AUTH_PROVIDER=supabase` | 1min |
| Validar que Supabase ainda recebe (não foi tocado durante cutover — apenas dump) | 5-10min |
| Smoke tests no Supabase | 5min |
| Banner manutenção OFF | imediato |
| **Total RTO:** | **~20-30min** |

Pós-rollback: análise de root cause + ajustes + reagendamento (D+14 mínimo).

## Log

- —

## Definition of Done

- [ ] Postgres Oracle Cloud em produção há 30+ dias sem P0/P1
- [ ] Backup automático funcionando + 1 restore bem-sucedido em staging
- [ ] Auth BetterAuth com 100% dos fluxos cobertos por E2E
- [ ] Storage R2 com 100% dos uploads novos + 100% dos antigos migrados
- [ ] Realtime LISTEN/NOTIFY estável (zero perda de mensagens em load test)
- [ ] Custo mensal documentado e ≤R$ 150
- [ ] Supabase decomissionado
- [ ] CHANGELOG atualizado
- [ ] Roadmap Sprint 19b → done

## Retro

- —
