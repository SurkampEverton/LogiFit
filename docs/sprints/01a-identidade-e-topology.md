# Sprint 01a — Identidade e Topology

- **Início:** planejado (depois do Sprint 00)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #2

## Goal

Autenticação + **cadastro central `persons`** + hierarquia completa (group/tenant/company/unit com `person_id` FK onde aplicável) + RLS raiz + seed dos 5 cenários canônicos (4 multi-empresa + 1 modo solo), tudo funcionando ponta-a-ponta.

## Critério de aceite

- Login via magic link + OAuth Google funciona
- MFA (TOTP) obrigatório para roles profissionais, opcional para aluno
- JWT contém custom claims: `tenant_id`, `group_ids[]` (se aplicável), `topology`
- **Tabela `persons` central** (PF ou PJ) com detecção automática do tipo pelo tamanho do documento digitado (11 dígitos = CPF/PF; 14 = CNPJ/PJ) + validação matemática
- **Busca automática de dados por CNPJ** via BrasilAPI (default) + ReceitaWS (fallback) + CNPJá! (opcional, pago, configurável pelo admin) com cache de 7 dias em `cnpj_cache`
- **Alerta de situação cadastral** no cadastro: empresa baixada/suspensa/inapta exige confirmação explícita com razão
- **Job semanal de validação de situação** de companies + suppliers ativos; emite alerta quando detecta mudança
- `companies` e `users` ganham `person_id` FK apontando para `persons`
- Hierarquia criada: `groups`, `tenants` (com 3 flags), `companies` (matriz/filial, linka `persons` kind=pj), `units` (local físico, sem person)
- Constraint no banco: exatamente 1 matriz por tenant
- CNPJ unique global entre `companies` (via constraint derivada de `persons.document` quando linkada a company)
- RLS raiz em todas as tabelas: `tenant_id = auth.jwt() ->> 'tenant_id'`
- Teste E2E: usuário do tenant A não vê dados do tenant B (nem via API, nem via Supabase client direto)
- Teste E2E: cadastrar pessoa PF → criar user linkando → não duplica dados de contato
- Teste E2E: cadastrar pessoa PJ → criar company-filial linkando → não duplica CNPJ/endereço
- Seed dos 5 cenários canônicos populado em dev (com persons + users + companies linkadas) — nota: 5º cenário (modo solo) usa `tenants.mode='solo'` que será criado no Sprint 01b; 01a popula somente os 4 multi-empresa
- Troca de contexto de tenant (para usuário multi-tenant) reassina JWT
- **Trial 14d + ciclo de retenção 30d (ADR 0066)**: tenant criado em `/signup` ganha `trial_ends_at = now() + 14 days` + `subscription_status='trialing'`. Job diário `process-trial-lifecycle` aplica:
  - **D+14 (trial expirou sem conversão)**: `status='trial_expired'` + UI bloqueada exceto export/conversão; banner "trial expirado, dados retidos por 30d"
  - **D+44 (30d após expirar)**: `anonymize-tenant` job dispara — preserva agregados estatísticos (contagem de members/sessões/receita simulada), remove **PII**: `persons.name='Anonimizado'` + `persons.document=NULL` + `persons.email=NULL` + `persons.phone=NULL` + cifra-com-chave-perdida em `prontuarios.content`, `assessments.notes`. Membership real permanece pra estatística de conversão.
  - **Conversão antes de D+44**: paciente vira `subscription_status='active'`, dados originais permanecem
  - Auditado em `audit_log action='trial.anonymized'` com `legal_basis='lgpd_art16_eliminacao'`
  - Implementação técnica: schemas têm `pii_eligible_for_anonymization bool` em colunas sensíveis para job filtrar

## Dependências

- Sprint 00 (infra pronta)

## Decisões tomadas

- [ADR 0002 — RLS como isolamento primário](../decisions/0002-rls-como-isolamento-primario.md)
- [ADR 0006 — Hierarquia group → tenant → company → unit](../decisions/0006-hierarquia-group-tenant-company-unit.md)
- [ADR 0007 — Topology owned vs franchise](../decisions/0007-topology-owned-vs-franchise.md)
- [ADR 0008 — Group como camada agregada](../decisions/0008-group-como-camada-agregada.md)
- [ADR 0009 — Loja avulsa não vira nível próprio](../decisions/0009-loja-avulsa-nao-vira-nivel-proprio.md)
- [ADR 0047 — Cadastro central de persons com FK em tabelas especializadas](../decisions/0047-cadastro-central-persons.md)
- [ADR 0048 — Busca automática de CNPJ via provider abstrato](../decisions/0048-busca-cnpj-provider-abstrato.md)
- [ADR 0078 — Hospedagem em duas fases](../decisions/0078-hospedagem-duas-fases-mvp-supabase-pos-mvp-oracle.md) — **Auth implementada de forma portátil**: JWT custom claims + cookie httpOnly próprio; **proibido `@supabase/auth-helpers-nextjs`** (lock-in que quebra Sprint 19b); usa `@supabase/supabase-js` apenas pra `signInWithOtp`/`signInWithOAuth`/`verifyOtp`, sessão extraída pra cookie próprio gerenciado pelo middleware Next.js

## Schemas Drizzle (esperado)

Em `packages/db/schema/persons.ts`:

- `persons` — `id uuid pk`, `tenant_id uuid not null`, `kind` enum (`pf`, `pj`), `name text not null` (nome completo OU razão social), `display_name text` (apelido OU nome fantasia), `document text` (CPF ou CNPJ sem formatação), `birth_date date nullable` (só PF), `sex text nullable` (só PF), `email text`, `phone text`, `address jsonb` (`{cep, logradouro, numero, complemento, bairro, cidade, uf}`), `notes text`, `archived_at timestamptz nullable`, timestamps. Índices: `(tenant_id, document)` unique; `(tenant_id, name)`; GIN em `address` se busca por cidade for frequente.

Em `packages/db/schema/cnpj-cache.ts`:

- `cnpj_cache` — `cnpj text pk` (14 dígitos normalizados), `data jsonb` (payload completo do provider), `provider_used text`, `situacao text` (ativa/suspensa/baixada/inapta), `fetched_at timestamptz`, `expires_at timestamptz`. **Global** (não tem tenant_id) — dado público de CNPJ é compartilhado entre tenants; reduz requests em 95%+.
- `tenant_cnpj_settings` — `tenant_id pk`, `provider_primary text default 'brasilapi'`, `provider_fallback text nullable`, `credentials_encrypted jsonb nullable` (API key do CNPJá! se aplicável), `active bool`

Em `packages/db/schema/identity.ts`:

- `groups` — `id`, `name`, `metadata jsonb`, timestamps (sem CNPJ/person — é camada organizacional, ver ADR 0008)
- `tenants` — `id`, `group_id nullable`, `name`, `topology` enum, `financial_mode` enum, `cross_company_access bool`, `subscription_status enum('trialing','active','trial_expired','suspended','anonymized') default 'trialing'`, `trial_ends_at timestamptz nullable`, timestamps. **Coluna `mode enum('multi','solo') default 'multi'` é adicionada em Sprint 01b** (junto com Plano Solo / ADR 0069 — wizard de onboarding decide o valor).
- `companies` — `id`, `tenant_id`, `person_id uuid not null` (FK persons kind=pj), `type` enum (`matriz`, `filial`), `parent_company_id nullable`, `ie text nullable`, `im text nullable`, `regime_tributario text nullable`, `cnes_code text nullable`, timestamps. Check constraint: `person.kind = 'pj'`. Unique `(tenant_id, type='matriz')` via index parcial.
- `units` — `id`, `tenant_id`, `company_id`, `name`, `address jsonb`, `capacity int nullable`, `area_m2 numeric nullable`, timestamps (sem person — é local físico)
- `users` — `id`, `tenant_id`, `person_id uuid not null` (FK persons kind=pf), `auth_user_id uuid` (FK Supabase Auth), `username text`, `mfa_enabled bool`, `last_login_at`. Check: `person.kind = 'pf'`.
- `user_tenants` — N:N entre users e tenants (user multi-tenant reusa mesmo `person_id` cross-tenant? Não — persons é por tenant; se mesma pessoa opera em 2 tenants, são 2 `persons` distintas mas podem compartilhar `auth_user_id`)

**RLS:** todas com `tenant_id = auth.jwt() ->> 'tenant_id'`.

## Rotas Next.js

- `/signup` — onboarding cria tenant + persons (matriz PJ) + company matriz + unit + primeiro user PF
- `/login`, `/select-tenant`, `/settings/mfa`
- `/app/pessoas` — lista de persons do tenant com filtros (kind, papéis ativos, arquivadas)
- `/app/pessoas/new` — cadastro genérico (detecta PF/PJ pelo documento)
- `/app/pessoas/[id]` — visão consolidada (dados + papéis ativos: user, member, supplier, company, lead, profissional)
- `/app/pessoas/[id]/edit`
- `/app/settings/empresas` — lista companies
- `/app/settings/empresas/new` — **linka persons kind=pj** + preenche dados específicos (type, IE, IM, CNES)
- `/app/settings/empresas/[id]/units` — CRUD de units
- `/app/settings/users` — lista users
- `/app/settings/users/new` — **linka persons kind=pf** + preenche dados específicos (role, scope, MFA)
- `/app/settings/pessoas/cnpj` — admin configura provider de busca CNPJ (BrasilAPI/ReceitaWS/CNPJá!) + cola API key + testa com CNPJ exemplo
- `/app/pessoas/[id]/refresh-cnpj` — ação para forçar nova consulta (ignora cache) em cadastro já existente

## Server Actions + API Routes

Server Actions em `apps/web/app/pessoas/actions.ts`:

- `searchPersons(query, { kind?, hasRole? })` — busca por nome/documento/email; opcional filtrar por papel ativo
- `lookupCnpj(cnpj)` — consulta via provider configurado (com cache 7d); retorna dados preenchíveis + situação cadastral. UI chama via `/api/pessoas/cnpj/[cnpj]` enquanto operador digita.
- `refreshCnpjData(personId)` — força nova consulta ignorando cache; atualiza campos da `persons` com dados vindos da Receita
- `createPerson(input, { autoFillCnpj })` — se documento é CNPJ e `autoFillCnpj=true` (default), chama lookup e preenche name/display_name/address/phone/email antes de salvar
- `updatePerson(id, patch)`
- `archivePerson(id)` — só permite se sem papéis ativos; se tem, sugere arquivar os papéis primeiro

API Routes:

- `GET /api/pessoas/cnpj/[cnpj]` — endpoint público (dentro do tenant scope via RLS); consulta cache → provider → retorna JSON normalizado
- `POST /api/jobs/cnpj/validate-situacao-weekly` — job Vercel Cron que revalida situação cadastral de companies/suppliers ativos e emite alerta se mudou

Em `apps/web/app/settings/empresas/actions.ts`:
- `createCompany(personId, type, parentId?, ie, im, cnesCode?)` — linka persons existente
- Se `personId` for null, redireciona para fluxo "cadastre a PJ primeiro em /app/pessoas/new"

Em `apps/web/app/settings/users/actions.ts`:
- `createUser(personId, { role, scope, mfaEnabled })` + envia magic link por email

## Eventos de domínio emitidos

- `person.created`, `person.updated`, `person.archived`
- `company.created`, `unit.created`
- `user.invited`, `user.activated`

## Commit

- [ ] Supabase Auth + magic link + OAuth Google — **uso minimalista**: só `signInWithOtp`/`signInWithOAuth`/`verifyOtp` (regra portabilidade ADR 0078); sessão extraída pra cookie httpOnly próprio gerenciado pelo middleware
- [ ] **Cookie de sessão próprio** (`logifit_session`) com JWT assinado por `JWT_SECRET` LogiFit; middleware `apps/web/middleware.ts` valida e injeta contexto em `request.headers`; **NÃO usar `@supabase/auth-helpers-nextjs`** (regra portabilidade ADR 0078 — lock-in)
- [ ] MFA obrigatório para roles profissionais (TOTP)
- [ ] Supabase Auth Hook injetando `tenant_id` + `group_ids` no JWT — **espelhado** no JWT do cookie próprio (Sprint 19b vai gerar JWT direto sem Supabase Auth Hook)
- [ ] Schema Drizzle: `persons` (central), `cnpj_cache` (global), `tenant_cnpj_settings`, `groups`, `tenants` (flags + `mode` enum), `companies` (com `person_id` FK + type + regras fiscais), `units` (sem person), `users` (com `person_id` FK + auth_user_id), `user_tenants`
- [ ] **Schema `system_alerts` + `system_alert_occurrences`** (ADR 0071) com RLS por tenant_id + role-based visibility (`min_role`) + índices de fingerprint + request_id + member_id (LGPD link) + trigger SQL que cria `security_incidents` automaticamente quando `severity='critical'` + `category IN ('security','data_leak','compliance')`
- [ ] **`audit_log` particionado por mês desde dia 1** (ADR 0072 + regra 34): PARTITION BY RANGE (at), 12 partições futuras criadas; indexes na partição (`tenant_id, at DESC`), (`tenant_id, user_id, at DESC`), (`tenant_id, resource_type, resource_id`); retenção 5 anos; `@volume_estimate_yearly: 50M+`
- [ ] **`audit_log` com hash chain (ADR 0073 + regra 39)**: colunas `current_hash text NOT NULL` + `previous_hash text NULL`; trigger `audit_log_hash_chain_trigger` BEFORE INSERT computa `current_hash = sha256(id || tenant_id || at || actor_user_id || action || sanitized_payload || COALESCE(previous_hash, ''))` e busca `previous_hash` da última linha do mesmo `tenant_id` (lock SELECT FOR UPDATE para serializar); job semanal `/api/jobs/verify-audit-integrity` percorre cadeia por tenant — quebra dispara `system_alerts severity=critical category=security`
- [ ] **Schema `system_audit_anchor`** (ADR 0073) — `id`, `tenant_id`, `anchor_at timestamptz`, `last_hash text`, `signature text` (assinado com chave LogiFit), `external_ref text` (S3 Object Lock URL, WORM); job `/api/jobs/anchor-audit-hourly` cola último hash em S3 us-east-1 com Object Lock 5y — torna adulteração detectável mesmo com acesso DB direto
- [ ] **Tabela `auth_attempts` (ADR 0073 — login lockout)**: `id`, `email text nullable`, `ip text`, `user_agent text`, `attempted_at timestamptz`, `success bool`, `failure_reason text nullable` (`wrong_password`, `mfa_failed`, `user_disabled`, `rate_limited`, `captcha_failed`); particionada por mês; retenção 30 dias (regras 5+34); índices `(email, attempted_at DESC)` + `(ip, attempted_at DESC)`; políticas: 5 falhas em 15 min por (email OR ip) → lockout 30 min em `auth_lockouts (email, ip, locked_until)`; captcha Turnstile ativa após 3 falhas; alerta email ao titular após 5 falhas ("tentaram logar na sua conta")
- [ ] **Cloudflare Turnstile integrado** (ADR 0073 — bot protection): no `/signup` (sempre), `/login` (após 3 falhas no IP), `/forgot` (sempre), trial start; widget React em `packages/ui/auth/turnstile-widget.tsx`; verificação server-side via `verifyTurnstile(token)` em `packages/security/turnstile.ts` antes de processar Server Action
- [ ] **Página `/meu/sessoes`** (ADR 0073 — session management): lista todas as sessões ativas do user (device, IP, último acesso) buscando de `auth.sessions` Supabase; botão "Encerrar todas as outras" chama Supabase Auth `signOut({ scope: 'others' })` invalidando refresh tokens; trocar senha invalida todos refresh tokens automaticamente
- [ ] **Recovery codes para TOTP** — ao habilitar MFA, gera 10 recovery codes (one-time use); user baixa em arquivo TXT; armazenados hasheados em `user_mfa_recovery_codes (user_id, code_hash, used_at)`; cada uso invalida o código
- [ ] **`tenants.shard_url text NULL`** (ADR 0072) — preparação para sharding futuro; NULL=cluster compartilhado, preenchido=cluster dedicado
- [ ] Schemas `archive_jobs` + `compliance_retention_log` (ADR 0072) — controle e audit das ações de archive/delete
- [ ] **Jobs Vercel Cron iniciais** (ADR 0072): `create-next-partitions` (mensal), `monitor-database-size` (diário), `vacuum-analyze-partitions` (semanal)
- [ ] Particionamento por mês em `system_alert_occurrences` (ring buffer 20 últimos por alert) + retention job noturno conforme `retention_days` (30/90/365/1825 por severity)
- [ ] Notification queue `notification_queue(channel, payload, scheduled_at, sent_at)` para email/WhatsApp assíncronos
- [ ] Constraints: 1-matriz-por-tenant; `companies.person_id` kind=pj; `users.person_id` kind=pf; `(tenant_id, document)` unique em persons
- [ ] Validador de CPF/CNPJ em `packages/db/persons/document.ts` (dígito verificador)
- [ ] Interface `CnpjProvider` em `packages/ai/cnpj/provider.ts` (contrato comum `lookup(cnpj) → CnpjData`)
- [ ] Adapters: `brasilapi.ts` (default), `receitaws.ts` (fallback), `cnpja.ts` (upgrade pago opcional)
- [ ] Orquestrador com fallback em cadeia + cache 7d em `cnpj_cache`
- [ ] UI `/app/settings/pessoas/cnpj` para admin configurar provider + credenciais + testar
- [ ] Auto-fill ao digitar CNPJ em `/app/pessoas/new` (loading state + preview dos dados antes de confirmar)
- [ ] Alerta de situação ≠ ativa (modal obrigatório confirmar + razão em campo livre)
- [ ] Botão "atualizar dados da Receita" em `/app/pessoas/[id]`
- [ ] Job Vercel Cron semanal `/api/jobs/cnpj/validate-situacao-weekly` para companies + suppliers ativos
- [ ] RLS raiz em todas as tabelas criadas (persons incluída)
- [ ] Script de seed com os 4 cenários canônicos multi-empresa (persons + companies + users linkados corretamente); 5º cenário modo solo entra em Sprint 01b junto com a coluna `tenants.mode`
- [ ] Teste E2E Playwright: isolamento entre tenants + fluxo de cadastro pessoa → papel
- [ ] Teste CI: script que falha se tabela nova não tem RLS
- [ ] Página `/login`, `/signup`, `/select-tenant`, `/settings/mfa`
- [ ] Página `/app/pessoas/*` (CRUD genérico com detecção automática PF/PJ)
- [ ] Componente `<PersonPicker>` reusável (autocomplete que busca persons + mostra papéis ativos) — usado nas telas especializadas
- [ ] Wizard `/signup` cria tenant + persons matriz + company matriz + unit + user admin atomicamente
- [ ] Logout global + revogação por dispositivo
- [ ] **Trial 14d + ciclo de retenção 30d (ADR 0066)** — schema + jobs + UI completos:
  - [ ] Coluna `tenants.subscription_status enum('trialing','active','trial_expired','suspended','anonymized') default 'trialing'` + `trial_ends_at timestamptz` populado em `/signup`
  - [ ] Job Vercel Cron diário `/api/jobs/process-trial-lifecycle` que: (a) marca `trial_expired` em D+14 sem conversão; (b) bloqueia UI exceto export/conversão (banner amigável); (c) executa `anonymize_trial_data(tenant_id)` em D+44 (30d após expirar)
  - [ ] Função SQL `anonymize_trial_data(tenant_id uuid)` — preserva agregados estatísticos (member_count, session_count, revenue_simulated) + remove PII: `persons.name='Anonimizado'`, `persons.document=NULL`, `persons.email=NULL`, `persons.phone=NULL`; cifra-com-chave-perdida em `prontuarios.content`, `assessments.notes` (rotação de KEK do tenant invalida acesso); muda `subscription_status='anonymized'`
  - [ ] Trigger grava em `audit_log action='trial.anonymized'` + `legal_basis='lgpd_art16_eliminacao'` + summary do que foi anonimizado
  - [ ] Conversão antes de D+44 (`subscription_status='active'`): preserva dados originais; cancela job pendente
  - [ ] Schemas têm coluna `pii_eligible_for_anonymization bool` em colunas sensíveis para job filtrar (default `true` para colunas PII)
  - [ ] Teste E2E Playwright: tenant criado em /signup → fast-forward 14d → status `trial_expired` + UI bloqueada → fast-forward +30d → `anonymized` + dados originais não recuperáveis (PII NULL/random)
  - [ ] Teste E2E: conversão em D+10 → `active` + dados intactos
  - [ ] Documentação: cascata de anonimização em `docs/compliance/data-deletion-playbook.md` (referenciada por ADR 0054)

## Stretch

- [ ] Impersonation para suporte LogiFit (com audit log reforçado)
- [ ] Merge de `persons` duplicadas (quando detecta CPF/CNPJ igual de tenants distintos não é permitido; dentro do mesmo tenant unique impede — mas pode haver dedupe por nome+nasc similar)
- [ ] Import CSV de pessoas + linkagem automática com papéis (ex: CSV de alunos vindo de outro sistema cria persons + members)

## Log

- **2026-05-12 (noite) — Faixa C (RBAC + JWT claims + MFA helpers) FECHADA 🟢: 12 system roles + 25 permissions seeded, customSession injetando claims, gate MFA pronto.**
  - **Schema RBAC** em `packages/db/src/schema/rbac.ts` — 6 tabelas: `roles` (system + tenant-scoped), `permissions` (catálogo global), `role_permissions` (N:N), `user_roles` (com scope_company_id + scope_unit_id opcional), `user_permission_grants` (override direto), `user_mfa_recovery_codes` (10 codes one-time hash bcrypt).
  - **Migration `0002_brown_talon.sql`** — 6 tabelas + 12 índices + 13 FKs.
  - **`policies/0006_rbac_rls.sql`** — RLS por tenant_id em `roles`/`user_roles`/`user_permission_grants` (com regra especial: system roles visíveis a todos, custom isoladas); `permissions`/`role_permissions` read-only pra autenticados; `user_mfa_recovery_codes` DENY direto (só via Server Action).
  - **`policies/0007_rbac_seed.sql`** — seed canônico idempotente:
    - **12 system roles**: `super_admin`, `tenant_owner`, `gerente`, `recepcao`, `medico`, `fisio`, `nutri`, `personal`, `enfermeiro`, `dpo`, `contador_externo`, `member`. 8 com `requires_mfa=true` (todas profissionais + admins críticos — regra 43).
    - **25 permissions catálogo** organizadas em categorias `identidade`/`empresa`/`crm`/`seguranca`. 7 marcadas `is_high_risk=true` (consistente com `HIGH_RISK_ACTIONS` em `@repo/security`).
    - **role_permissions assignments**: super_admin (25/25), tenant_owner (25/25), gerente (15), recepcao (8), profissionais (5 cada — base; clínicas vêm nas sprints donas), member (3).
  - **`@repo/security/src/require-recent-mfa.ts`** — `requireRecentMfa({ session, maxAgeMins })` + `requireRecentMfaForAction(session, actionName)` (lookup automático em `HIGH_RISK_ACTIONS`) + `isMfaRecent()` helper boolean pra UI. `MfaRecentRequiredError` com `code='MFA_RECENT_REQUIRED'` + `maxAgeMins` + `mfaAt` pra envelope ADR 0071. **13/13 Vitest tests verdes** cobrindo: limite exato 15min, custom maxAgeMins, mfaAt null, lookup high-risk vs não-high-risk, helper UI.
  - **Plugin `customSession`** em `@repo/auth/server` — injeta no payload de sessão BetterAuth:
    - `logifit.tenantId` (de `user_tenants.is_default`)
    - `logifit.topology` (de `tenants.topology`)
    - `logifit.roles[]` (keys das roles ativas)
    - `logifit.requiresMfa` (true se qualquer role tem `requires_mfa=true`)
    - `logifit.mfaAt` (proxy via `session.updatedAt` — Sprint 02+ refina via `auth_two_factor.lastVerifiedAt`)
    - Retorna `logifit: null` se user_auth existe mas ainda sem `users` row LogiFit (fluxo signup wizard incompleto — Faixa E desbloqueia).
  - **UI skeletons em `apps/web/app/`**:
    - `/app/settings/mfa` — Server Component com guard `auth.api.getSession`; 3 seções (TOTP / Passkey / Recovery codes) marcadas como "Faixa D+" (enrollment real vem com email Mailhog plugado).
    - `/meu/sessoes` — guard + mostra sessão atual (`session.session.id` + `createdAt`); lista completa de sessões aguarda `<ResponsiveTable>` (regra 31).
  - **Middleware estendido** — `PROTECTED_PATH_PREFIXES` agora cobre `/app` E `/meu` (cookie ausente → redirect `/login?returnTo=...`).
  - **Validações end-to-end:**
    - Typecheck `@repo/auth` + `@repo/db` + `@repo/security` + `@app/web` ✅
    - `pnpm --filter @app/web build` → **8 rotas** (`/`, `/login`, `/signup`, `/seguranca`, `/api/auth/[...all]`, `/app/settings/mfa`, `/meu/sessoes`) + middleware 34.7KB ✅
    - Migration aplicada idempotente (2× consecutivos) ✅
    - **`db:rls-check` 4 regras OK em 23 tabelas** (era 17 na Faixa B) ✅
    - **34 + 13 = 47 Vitest tests** verdes (validador CPF/CNPJ + MFA gates) ✅
    - 8 lints custom limpos em **108 code + 2 css files** ✅
    - **Seed validado em DB**: 12 system roles + 25 permissions + role_permissions corretas (super_admin/tenant_owner com 25 cada, gerente 15, recepcao 8, profissionais 5 base).
  - **Lições documentadas:**
    1. **`drizzle-orm` v0.45 esperava `where` clauses tipadas com `sql` template literal** quando comparando UUIDs com string — workaround `drizzleSql\`${user.id}::uuid\`` (BetterAuth user.id é text, nossa users.auth_user_id é uuid).
    2. **`customSession` plugin atrasa cada session lookup em ~4 queries** (users + tenants + roles + role_permissions). Sprint 02+ vai cachear em Redis com TTL 60s.
    3. **System roles seed precisa `ON CONFLICT DO NOTHING`** porque idempotência exige re-rodar; sem isso, 2º migrate quebra com PK violation.
    4. **`pgEnum` muda nome de coluna em policy SQL** — `requires_mfa` em SQL vs `requiresMfa` em Drizzle TS (snake_case ↔ camelCase). Policies seed em SQL puro usam snake_case sempre.
    5. **Schema RBAC `tenant_id` NULL é válido pra system roles** — policy `roles_select` usa `OR` permitindo visibilidade global; UPDATE/DELETE restrito a `tenant_id NOT NULL AND system=false`.

  **Próxima faixa:** D — Persons + CNPJ lookup (BrasilAPI adapter + UI `/app/pessoas/*` + `<PersonPicker>` + auto-fill CNPJ).

- **2026-05-12 (tarde) — Faixa B (Auth + sessões) FECHADA 🟢: BetterAuth integrado, login funcional, middleware guard ativo.**
  - **[ADR 0092](../decisions/0092-betterauth-vs-lucia.md)** publicado — **BetterAuth** escolhido sobre Lucia. Justificativa: TOTP + WebAuthn + magic link + recovery codes nativos out-of-the-box; Lucia exigiria ~500-700 linhas de boilerplate pra paridade. Lock-in mitigado via cookie httpOnly + JWT padrão (migrar é DB migration + ~200 linhas wrapper).
  - **`packages/auth/`** criado com 3 entry points: `@repo/auth/server` (instância `auth` + `nextJsHandler`), `@repo/auth/client` (Client Components, `signIn`/`signOut`/`useSession`), `@repo/auth` (placeholder forçando import explícito do subpath correto pra evitar shipar server-only no bundle).
  - **8 tabelas novas em `@repo/db/schema/`** (resolveu dep circular `@repo/db ↔ @repo/auth` movendo schemas pra `@repo/db`):
    - `better-auth.ts` — `auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_passkey` (6 tabelas BetterAuth com prefixo `auth_` coexistindo com nossa `users` table via FK `users.auth_user_id`)
    - `auth-attempts.ts` — `auth_attempts` + `auth_lockouts` LogiFit-owned (ADR 0073 camada 2 lockout 5/15min → 30min cooldown). Particionamento + retention 30d ficam pra Faixa F.
  - **`packages/db/src/policies/0005_auth_rls.sql`** — 8 policies (`FOR ALL TO logifit_app`) com FORCE RLS bloqueando acesso direto via `postgres` superuser; allow tudo pro role app (BetterAuth precisa). Sprint 02+ avaliará role `auth_internal` separado pra isolar.
  - **Migration `0001_flawless_hannibal_king.sql`** gerada via `drizzle-kit generate` — 8 tabelas + FKs + 11 índices.
  - **drizzle-orm 0.36 → 0.45 + drizzle-kit 0.28 → 0.30** — BetterAuth 1.6.11 exige peer 0.45+. Schemas existentes da Faixa A continuam funcionando (typecheck + 34 tests verdes pós-bump).
  - **Config BetterAuth** (`@repo/auth/server`) — pool dedicado `authPool` (separado do principal pra facilitar rotação); cookie prefix `logifit` (override do default `better-auth`); plugins: `magicLink` (15min expiry, sendMagicLink stub que loga URL no console em dev) + `twoFactor` (TOTP + backup codes nativos); `emailAndPassword: { enabled: false }` (MVP só magic link); rate limit in-memory 10/60s.
  - **`apps/web/app/api/auth/[...all]/route.ts`** — catch-all Next.js 15 delegando pro BetterAuth via `nextJsHandler()` (helper exportado por `@repo/auth/server`, encapsula `toNextJsHandler` do BetterAuth — apps/web não precisa declarar `better-auth` como direct dep).
  - **`apps/web/middleware.ts` estendido** — adiciona guard de sessão (LEVE — só presença do cookie `logifit.session_token`) pra rotas `/app/*`. Validação real (DB lookup) acontece em Server Component layout via `auth.api.getSession({ headers })`. Edge runtime sem `pg` impede validação full no middleware; ainda assim, defense in depth: cookie ausente = redirect imediato com `returnTo` query param.
  - **`/login` page** — Server Component renderiza `<LoginForm>` Client Component. Form input email + button "Enviar link mágico" → `authClient.signIn.magicLink({ email, callbackURL })`. UX states: `idle` / `sending` / `sent` (mostra "Confira seu email") / `error`. Token `// toast-exempt:` em mensagem do BetterAuth (Faixa B fechamento mapeia pra catálogo i18n). `aria-describedby` + `aria-invalid` + `role="alert"` (a11y regra 45).
  - **`/signup` page skeleton** — "Onboarding completo entra na Sprint 01a Faixa E" (depende de Faixa D persons CRUD + lookup CNPJ).
  - **Validações end-to-end:**
    - Typecheck `@repo/auth` ✅ (precisou `declaration: false` no tsconfig — BetterAuth gera inferência de tipo massiva via zod 4 que ultrapassa o limite TS)
    - Typecheck `@repo/db` + `@app/web` ✅
    - `pnpm --filter @app/web build` → 6 rotas geradas (`/`, `/login`, `/signup`, `/seguranca`, `/api/auth/[...all]`, middleware 34.7KB) ✅
    - Migration aplicada idempotente (2× consecutivos) ✅
    - `db:rls-check` (4 regras com 17 tabelas) ✅
    - 34 Vitest tests verdes ainda ✅
    - 8 lints custom limpos em **102 code + 2 css files** ✅
  - **Lições documentadas:**
    1. **Dependência `@repo/db ↔ @repo/auth` é circular se schemas auth ficam no @repo/auth** (que precisa importar db client). Solução: schemas (SQL state) ficam em `@repo/db`; helpers/config (`@repo/auth`) consomem schemas via import e `@repo/db` declara `@repo/auth` como peer apenas pra re-export em `schema/index.ts`. Sprint 01a optou por simplicidade: schemas em `@repo/db`.
    2. **BetterAuth tem TS inference massiva** — vários `cannot be named without reference to zod/v4/core`. Workaround: `declaration: false` + `declarationMap: false` no tsconfig de `@repo/auth` (não precisamos shipar .d.ts pra packages internos do workspace).
    3. **BetterAuth `next-js` subpath** não é direct dep do `apps/web` — encapsulamos via `nextJsHandler` helper no `@repo/auth/server`. Mantém apps/web livre de import quirk do better-auth.
    4. **Cookie name padrão BetterAuth é `better-auth.session_token`** — override via `advanced.cookiePrefix: 'logifit'` produz `logifit.session_token`. Middleware lê esse nome.
    5. **Edge runtime no middleware impede pg DB lookup** — guard é "presença do cookie" (não validade); validação real fica em Server Component layout. Defense in depth: cookie ausente = redirect, cookie inválido = layout retorna 401/redirect.

  **Próxima faixa:** C — RBAC + JWT custom claims + MFA (TOTP enrollment + recovery codes + `/settings/mfa`).

- **2026-05-12 — Faixa A (Schemas + RLS base) FECHADA 🟢: fundamento da hierarquia organizacional.**
  - **Validador CPF/CNPJ** em `packages/db/src/persons/document.ts` — algoritmo módulo 11 (Receita Federal) zero-dep, com detecção automática PF/PJ pelo tamanho dos dígitos. API: `parseDocument(input)`, `isValidCpf`, `isValidCnpj`, `normalizeDocument`, `formatDocument`. **34/34 Vitest tests verdes** cobrindo CPFs/CNPJs canônicos válidos (incluindo Correios + Bradesco públicos), 5 razões de falha (`empty`, `invalid_length`, `all_same_digit`, `check_digit_mismatch`, formatação parcial).
  - **Schemas Drizzle**: 9 tabelas em `packages/db/src/schema/`:
    - `persons.ts` — cadastro central PF/PJ (ADR 0047) com unique index parcial `(tenant_id, document) WHERE document IS NOT NULL`.
    - `cnpj-cache.ts` — cache GLOBAL Receita Federal (ADR 0048) + `tenant_cnpj_settings` por tenant.
    - `identity.ts` — `groups` (agregado), `tenants` (+ topology/financial_mode/cross_company_access/subscription_status/trial_ends_at/shard_url/default_locale), `companies` (matriz/filial + person_id PJ), `units`, `users` (+ person_id PF + auth_user_id + mfa_enabled), `user_tenants` (N:N).
    - Total: 5 enums Postgres + 9 tabelas + 15 índices + 6 FKs. Migration gerada: `migrations/0000_milky_dark_beast.sql` (162 linhas).
  - **RLS policies em SQL puro** (regra 1 + soberania perpétua #1) — 4 arquivos em `packages/db/src/policies/`:
    - `0001_persons_rls.sql` — 4 policies (SELECT/INSERT/UPDATE/DELETE) usando `current_setting('app.tenant_id', true)::uuid` + `ENABLE` + `FORCE` RLS.
    - `0002_identity_rls.sql` — 16 policies cobrindo tenants/groups/companies/units/users/user_tenants; `user_tenants` tem policy especial pra `/select-tenant` (lê via `app.user_id` antes do tenant ser escolhido).
    - `0003_cnpj_cache_rls.sql` — leitura LIVRE pra qualquer autenticado (cache global), WRITE só via Server Action.
    - `0004_person_kind_check.sql` — 3 triggers comportamentais: `companies.person_id` kind=pj, `users.person_id` kind=pf, `companies.parent_company_id` aponta pra matriz mesmo tenant.
  - **Role `logifit_app`** (`init/0001_roles.sql`) — non-superuser, sem BYPASSRLS; é o role das Server Actions/API Routes. `postgres` superuser bypassa RLS por design (não pode ser usado em queries de aplicação). Sem isso descoberto a tempo, smoke test ENGANARIA (Sprint 19+ teria surpresa em prod com RLS aparente mas não-aplicado).
  - **`migrate.ts` runner refatorado em 3 fases**: init (extensions + roles) → drizzle (tabelas) → policies (RLS + triggers); idempotente via `DROP IF EXISTS` automático em policies + `DROP TRIGGER IF EXISTS` explícito nos SQLs + `CREATE OR REPLACE FUNCTION`. **Validado: 2 runs consecutivos sem erro.**
  - **`db:rls-check` ESTENDIDO de 1 → 4 regras**:
    1. `tenant-id-needs-rls`: tabela com `tenant_id` sem RLS habilitada
    2. `rls-needs-force`: RLS sem FORCE (table owner bypassa)
    3. `rls-needs-policy`: RLS sem nenhuma policy (DENY total silencioso)
    4. `runtime-isolation` (opt-in via `RLS_CHECK_RUNTIME=1`): cria 2 tenants fictícios + INSERT em cada, valida que role `logifit_app` com `app.tenant_id`=A só vê dado de A; ROLLBACK no final. Resultado: **isolamento real comprovado em transação automatizada**.
  - **Smoke test em prod local (4/4 passou):**
    - Tentativa 1 (company com PF) → trigger bloqueia ✅
    - Tentativa 2 (matriz com PJ) → passa ✅
    - Tentativa 3 (2ª matriz mesmo tenant) → unique parcial bloqueia ✅
    - Tentativa 4 (filial sem parent) → trigger bloqueia ✅
    - Tentativa 5 (filial com matriz parent) → passa ✅
  - **Lições documentadas:**
    1. **`postgres` superuser bypassa RLS por design** — `FORCE ROW LEVEL SECURITY` força só pra table owner, não pra superuser global. App MUST usar role dedicado (`logifit_app` aqui) — descoberto durante primeiro smoke test que enganosamente passou sem o role.
    2. **`drizzle-kit` é CJS, não aceita `.js` extension em imports TypeScript** — usar imports sem extensão (`./persons` em vez de `./persons.js` ou `./persons.ts`).
    3. **`noUncheckedIndexedAccess: true`** força `?? defaultValue` em acessos `array[i]` mesmo quando length é provadamente conhecido — vale o cost por catch bugs reais de off-by-one.
    4. **Policies SQL precisam de `DROP IF EXISTS` antes de CREATE** (não há `CREATE OR REPLACE POLICY`); regex no migrator extrai nomes de `CREATE POLICY ... ON ...` automaticamente, mas triggers ficam com DROP explícito no SQL (regex multi-linha era frágil).
    5. **`relforcerowsecurity` é coluna separada** de `relrowsecurity` em `pg_class` — checar AMBAS no lint estático.

  **Próxima faixa:** B — Auth + sessões (BetterAuth/Lucia + cookie httpOnly + middleware + `auth_attempts` + lockout + Turnstile).

## Definition of Done

- [ ] Feature flag `auth_v1` criada
- [ ] Testes unit (validador CPF/CNPJ) + E2E verdes (incluindo os 4 cenários multi-empresa do seed; 5º solo cobre Sprint 01b)
- [ ] RLS verificada nos 4 cenários multi-empresa (5º solo é DoD do Sprint 01b)
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG.md atualizado
- [ ] Roadmap atualizado (item #2 → done)
- [ ] Zero violação de regras (1, 22, 24 cobertas por constraints)

## Retro

- —
