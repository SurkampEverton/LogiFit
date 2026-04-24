# Sprint 01a — Identidade e Topology

- **Início:** planejado (depois do Sprint 00)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #2

## Goal

Autenticação + **cadastro central `persons`** + hierarquia completa (group/tenant/company/unit com `person_id` FK onde aplicável) + RLS raiz + seed dos 4 cenários canônicos, tudo funcionando ponta-a-ponta.

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
- Seed dos 4 cenários canônicos populado em dev (com persons + users + companies linkadas)
- Troca de contexto de tenant (para usuário multi-tenant) reassina JWT

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

## Schemas Drizzle (esperado)

Em `packages/db/schema/persons.ts`:

- `persons` — `id uuid pk`, `tenant_id uuid not null`, `kind` enum (`pf`, `pj`), `name text not null` (nome completo OU razão social), `display_name text` (apelido OU nome fantasia), `document text` (CPF ou CNPJ sem formatação), `birth_date date nullable` (só PF), `sex text nullable` (só PF), `email text`, `phone text`, `address jsonb` (`{cep, logradouro, numero, complemento, bairro, cidade, uf}`), `notes text`, `archived_at timestamptz nullable`, timestamps. Índices: `(tenant_id, document)` unique; `(tenant_id, name)`; GIN em `address` se busca por cidade for frequente.

Em `packages/db/schema/cnpj-cache.ts`:

- `cnpj_cache` — `cnpj text pk` (14 dígitos normalizados), `data jsonb` (payload completo do provider), `provider_used text`, `situacao text` (ativa/suspensa/baixada/inapta), `fetched_at timestamptz`, `expires_at timestamptz`. **Global** (não tem tenant_id) — dado público de CNPJ é compartilhado entre tenants; reduz requests em 95%+.
- `tenant_cnpj_settings` — `tenant_id pk`, `provider_primary text default 'brasilapi'`, `provider_fallback text nullable`, `credentials_encrypted jsonb nullable` (API key do CNPJá! se aplicável), `active bool`

Em `packages/db/schema/identity.ts`:

- `groups` — `id`, `name`, `metadata jsonb`, timestamps (sem CNPJ/person — é camada organizacional, ver ADR 0008)
- `tenants` — `id`, `group_id nullable`, `name`, `topology` enum, `financial_mode` enum, `cross_company_access bool`, timestamps
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

- [ ] Supabase Auth + magic link + OAuth Google
- [ ] MFA obrigatório para roles profissionais (TOTP)
- [ ] Supabase Auth Hook injetando `tenant_id` + `group_ids` no JWT
- [ ] Schema Drizzle: `persons` (central), `cnpj_cache` (global), `tenant_cnpj_settings`, `groups`, `tenants` (flags + `mode` enum), `companies` (com `person_id` FK + type + regras fiscais), `units` (sem person), `users` (com `person_id` FK + auth_user_id), `user_tenants`
- [ ] **Schema `system_alerts` + `system_alert_occurrences`** (ADR 0071) com RLS por tenant_id + role-based visibility (`min_role`) + índices de fingerprint + request_id + member_id (LGPD link) + trigger SQL que cria `security_incidents` automaticamente quando `severity='critical'` + `category IN ('security','data_leak','compliance')`
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
- [ ] Script de seed com os 4 cenários canônicos (persons + companies + users linkados corretamente)
- [ ] Teste E2E Playwright: isolamento entre tenants + fluxo de cadastro pessoa → papel
- [ ] Teste CI: script que falha se tabela nova não tem RLS
- [ ] Página `/login`, `/signup`, `/select-tenant`, `/settings/mfa`
- [ ] Página `/app/pessoas/*` (CRUD genérico com detecção automática PF/PJ)
- [ ] Componente `<PersonPicker>` reusável (autocomplete que busca persons + mostra papéis ativos) — usado nas telas especializadas
- [ ] Wizard `/signup` cria tenant + persons matriz + company matriz + unit + user admin atomicamente
- [ ] Logout global + revogação por dispositivo

## Stretch

- [ ] Impersonation para suporte LogiFit (com audit log reforçado)
- [ ] Merge de `persons` duplicadas (quando detecta CPF/CNPJ igual de tenants distintos não é permitido; dentro do mesmo tenant unique impede — mas pode haver dedupe por nome+nasc similar)
- [ ] Import CSV de pessoas + linkagem automática com papéis (ex: CSV de alunos vindo de outro sistema cria persons + members)

## Log

- —

## Definition of Done

- [ ] Feature flag `auth_v1` criada
- [ ] Testes unit (validador CPF/CNPJ) + E2E verdes (incluindo os 4 cenários de seed)
- [ ] RLS verificada nos 4 cenários
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG.md atualizado
- [ ] Roadmap atualizado (item #2 → done)
- [ ] Zero violação de regras (1, 22, 24 cobertas por constraints)

## Retro

- —
