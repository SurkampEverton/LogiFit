# Sprint 02 — Geral · CRM unificado (pessoas)

- **Área:** geral
- **Início:** planejado (depois do Sprint 01b)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #4

## Goal

Perfil único cross-module do aluno/paciente (`members`), timeline append-only (`member_events`), tags e anotações livres — base que todas as verticais consomem. **Entrega também o "hub operacional"** do paciente (ADR 0069): header fixo + action bar + tabs por visão (auto por role) + modo atendimento + sidebar de histórico + registry `registerMemberAction`. Em `mode='solo'` (autônomo), perfil sem tabs e action bar expandida. Entrega também **timeline integrada** e **cache `member_insights`** (ADR 0070) — widgets cross-module consomem.

**Entrega também o passaporte do paciente cross-tenant (ADR 0077):** schema (`patient_module_types` lookup, `patient_company_links`, `patient_link_modules`, `patient_data_access_log`) + fluxo de **invite-link** (profissional cadastra dados mínimos, paciente cria conta ou loga, aceita parcial ou total) + **cadastro proativo** (paciente cria conta sozinho em `app.logifit.com.br/cadastro`) + **convite inverso** (paciente convida profissional/empresa) + tela de pedidos pendentes + tela de privacidade do paciente (compartilhamento + acessos) + função SQL `has_cross_tenant_access()` + indicador "vinculado em N empresas" no perfil + tab "Outras Empresas" (read-only, dados liberados por outros tenants). Constraint global "1 módulo ativo por paciente em toda a rede" via trigger.

## Critério de aceite

- `members` cadastrado, editado, arquivado (soft-delete) respeitando RLS de tenant + scope
- Timeline `/app/members/[id]/timeline` mostra eventos append-only ordenados por data
- Tags filtram lista `/app/members`
- Anotações livres (`member_notes`) com autoria, timestamp e visibilidade por role
- Transferência de aluno entre companies (quando `cross_company_access=true`) respeita regras 24 e 25
- Teste E2E: recepção do tenant A não vê `members` do tenant B; fisio de `unit:X` não vê `member_notes` de `unit:Y` sem scope
- Seed adicional: 5 `members` por cenário canônico (ver [multiempresa.md](../multiempresa.md))
- **Passaporte cross-tenant (ADR 0077):** profissional cadastra paciente com 1+ módulos → invite enviado por WhatsApp + email → paciente clica → **branch automático** (CPF existe → login + tela de pedido pendente; CPF novo → cadastro completo + login + tela de pedido pendente) → aceita parcial ou total → vínculo ativo + módulos liberados
- **Cadastro proativo:** paciente vai em `app.logifit.com.br/cadastro` (rota pública), confirma SMS + email + Turnstile, cria conta sem nenhum vínculo, vê tela inicial com [Convidar profissional / Aceitar pedido]
- **Convite inverso:** paciente busca profissional/empresa por nome ou CPF/CNPJ; se encontrado, cria pedido em sentido inverso; se não encontrado, vira lead comercial
- **Substituição:** novo vínculo do mesmo módulo (ex: trocar de academia) dispara confirmação ao paciente; aceitar revoga vínculo anterior automaticamente
- **Constraint global enforced:** teste tenta criar 2 vínculos `fisioterapia` ativos pro mesmo paciente → bloqueia
- **Audit:** toda leitura cross-tenant grava `patient_data_access_log` síncrono; teste E2E lê dado de paciente em outro tenant via vínculo válido → log gravado com `reader_user_id`/`source_tenant_id`/`module_type`/`category`
- **Tela de privacidade do paciente** (`/meu/privacidade/compartilhamento` + `/meu/privacidade/acessos`): paciente vê empresas vinculadas, módulos liberados, níveis de dados, histórico de acessos, pode pausar/revogar
- **Anti-spam invite:** rate limit 50 invites/dia/tenant + 3 invites/CPF/30d enforced
- **Limites duros:** teste E2E tenta ler `financial_transactions` cross-tenant via vínculo → bloqueado (financeiro nunca cruza); tenta ler `member_notes` Nível 5 cross-tenant → bloqueado

## Dependências

- Sprint 01b (RBAC com scope + consent)
- Sprint 01a (`persons` central via [ADR 0047](../decisions/0047-cadastro-central-persons.md) — `members.person_id` FK)
- Sprint 00 (Cloudflare Turnstile já provisionado para anti-bot no cadastro proativo)
- **`patient_data_access_log` schema (criado em Sprint 01b — regra 42 + ADR 0072 retenção 5a particionado mensal)**: Sprint 02 é o **primeiro consumidor** efetivo da tabela (escreve no log a cada leitura cross-tenant). Commit checklist obrigatório:
  - [ ] Validar via migration smoke que tabela `patient_data_access_log` existe + partição vigente do mês está criada; falha = bloqueia merge
  - [ ] Função SQL `has_cross_tenant_access(reader_user_id, person_id, module_type, category)` implementada em `packages/db/functions/has-cross-tenant-access.sql`, combina os 3 fatores (vínculo ativo + módulo autorizado + nível de dado coberto) — invocada por wrappers de leitura cross-tenant + grava no log síncrono não-bloqueante
  - [ ] **Lint custom `cross-tenant-read-must-log`** (regra 42) em Biome — bloqueia commit se Server Action lê tabela clínica/antropométrica/prescritiva/plano de tenant diferente do reader sem chamar `has_cross_tenant_access()` + grava em `patient_data_access_log`; exceção via `// cross-tenant-exempt: <motivo + ADR>` (raro)
  - [ ] **RIPD `docs/compliance/ripd/v1.0-passaporte-paciente.md`** publicado e assinado pelo DPO antes do feature flag passaporte ir a produção (regra 29 + ADR 0054); CI bloqueia se módulo passaporte ativo sem RIPD vigente
  - [ ] Entrada em `docs/compliance/lgpd-data-inventory.md` para `patient_data_access_log` confirmada (já presente)

## Decisões tomadas / ADRs esperados

- **ADR 0011 (esperado)** — Member como perfil único cross-module + timeline em `member_events` append-only. Tabelas específicas da vertical (prontuário fisio, antropometria nutri) referenciam `member_id` mas nunca duplicam dados básicos.
- **[ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)** — Passaporte do paciente cross-tenant + Modelo C híbrido (vínculo empresa + módulos explícitos) + 5 módulos canônicos lookup table + 2 paths de cadastro (reativo/proativo) + 5 níveis de dados + audit obrigatório. **Status: Proposed** — depende de parecer jurídico CFM/COFFITO/CFN antes da implementação.
- Pergunta aberta: como detectar aluno duplicado entre companies do mesmo tenant `owned`? Candidatos: CPF (vedado por LGPD em algumas ops) ou telefone+data nascimento. Fechar antes da implementação.
- Pergunta aberta (ADR 0077): limite de invites/dia por tenant (default sugerido 50) + limite de invites por CPF (default 3/30d) — fechar antes da implementação.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Cadastro de pessoa (`members`)
- Timeline do member (`member_events`)
- Tags e anotações livres
- **Dashboard do member (layout + 1º widget)** — `/app/members/[id]` vira container com slots para widgets; sprint 02 entrega o layout + widget "dados + timeline resumida (últimos 10 eventos)". Sprints 03/04/05/07 preenchem os outros slots.

## Rotas Next.js

**Backoffice profissional (`/app/*`):**

- `/app/members` — lista com busca, filtro por tag/company/unit, paginação (usa view `v_members_full` com JOIN em persons)
- `/app/members/new` — wizard com `<PersonPicker>` (busca ou cria persons) + formulário de campos específicos (home_unit, family_history, notas); botão "matricular agora" continua para plano/contrato do Sprint 04; **botão "enviar invite" cria pedido de vínculo + envia link** (path A — reativo)
- `/app/members/[id]` — home do paciente: layout com grid de widgets. MVP do sprint 02 entrega widget "dados + tags + timeline resumida". Slots vazios com placeholder para agenda (Sprint 03), financeiro (Sprint 04), copilot (Sprint 06), acessos (Sprint 08), conquistas/metas (Sprint 09). **Header mostra "vinculado em N empresas" quando paciente tem vínculos cross-tenant.** Tab "Outras Empresas" (read-only) lista módulos compartilhados por outros tenants (apenas o que o paciente liberou).
- `/app/members/[id]/edit` — edição
- `/app/members/[id]/timeline` — histórico completo
- `/app/members/[id]/notes` — anotações livres (com controle de visibilidade)
- `/app/invites` — pedidos de vínculo enviados pelo tenant: pendentes, aceitos, recusados, expirados; botão "reenviar"; botão "cancelar"

**Portal do paciente (`/meu/*`):**

- `/meu/dashboard` — tela inicial: pedidos pendentes, empresas vinculadas, atalho [Convidar profissional]
- `/meu/privacidade/compartilhamento` — empresas vinculadas + módulos liberados + níveis de dados; toggle por categoria; botões pausar/revogar/substituir por vínculo
- `/meu/privacidade/acessos` — histórico de leituras cross-tenant ("Dr. João Silva (Clínica Bem-Estar) leu seus exames laboratoriais em 23/04/2026 às 14:32")
- `/meu/convidar` — busca profissional/empresa por nome ou CPF/CNPJ; cria pedido inverso ou convida pra entrar no LogiFit (lead comercial)

**Rotas públicas:**

- `/cadastro` — auto-cadastro proativo (path B): SMS + email + Turnstile + senha + MFA opcional + Termos + Política Privacidade
- `/i/[token]` — landing do invite-link: branch automático "CPF existe → login" vs "CPF novo → cadastro"; confirmação anti-fraude por nome mascarado

## Server Actions + API Routes

Server Actions de members (em `apps/web/app/members/actions.ts`):

- `createMember({ personId, companyId, homeUnitId, familyHistory })` — linka `persons` existente (obrigatório); se persons não existe, UI redireciona para `/app/pessoas/new`. Emite `member.created`.
- `createMemberWithPerson(personInput, memberInput)` — helper que cria persons + members em 1 transação (usado no wizard de matrícula rápida)
- `updateMember(id, patch)` — só campos específicos de member; dados de identidade editam via `/app/pessoas/[id]/edit`
- `archiveMember(id, reason)` — soft-delete do papel; persons permanece ativa (pode ter outros papéis)
- `transferMember(id, toCompanyId)` — respeitando RLS + regras 24/25; emite `member.transferred`
- `addNote(memberId, body, visibility)` — `visibility ∈ {author_only, unit, company, tenant}` — **comentário `// ai-blocked: nota privada do profissional Nivel 5` (regra 41 + 42)**
- `addTag(memberId, tag)` / `removeTag(memberId, tag)`

Server Actions de passaporte cross-tenant (em `apps/web/app/passport/actions.ts` — ADR 0077):

- `sendPatientInvite({ name, cpf, phone, email?, modules: [{ moduleType, primaryUserId, dataLevelMax? }] })` — cria invite com token único 7d; envia WhatsApp + email; rate limit 50/dia/tenant + 3/CPF/30d. Emite `patient.invite_sent`.
- `resendPatientInvite(inviteId)` — reenvia se ainda não expirou
- `cancelPatientInvite(inviteId)` — invalida token
- `acceptPatientInvite({ inviteToken, acceptedModules: string[], dataLevelOverrides? })` — aceite parcial ou total; cria `patient_company_links` + `patient_link_modules` + `member` no tenant emissor; emite `patient.linked`. Trigger valida constraint global "1 módulo ativo por paciente"; se conflito, retorna `CONFLICT` com sugestão de substituição.
- `confirmModuleSubstitution({ newLinkId, replacedLinkId, replacedModuleType })` — paciente confirma trocar empresa em módulo já ativo; revoga módulo do vínculo antigo + ativa novo
- `pauseLink({ linkId, pausedUntil })` / `revokeLink({ linkId, reason })` — paciente pausa ou revoga
- `requestProvider({ targetTenantId?, targetCompanyId?, modules })` — **convite inverso** (path C); paciente busca empresa/profissional; se encontrado, cria pedido em sentido inverso; se não, vira lead comercial em `commercial_leads`
- `setSharingLevel({ linkModuleId, dataLevelMax })` — paciente ajusta nível por módulo
- `setCategoryGrant({ linkModuleId, category, granted })` — paciente abre/fecha categoria específica (Nível 4 granular)
- `getCrossTenantSummary(memberId)` — leitura agregada do passaporte do paciente (módulos liberados de outros tenants); chama internamente `has_cross_tenant_access()` + grava `patient_data_access_log`

Server Actions de cadastro proativo (em `apps/web/app/(public)/cadastro/actions.ts` — path B):

- `signupPatient({ name, cpf, phone, email, password, mfaEnabled, smsCode, emailToken, turnstileToken })` — cria `persons` + `users` (sem `member` em tenant nenhum); confirma SMS + email; rate limit 3/h/IP + 1/dia/CPF
- `requestSmsCode(phone, turnstileToken)` — envia código SMS pra confirmação
- `confirmSms(phone, code)` — valida código

Todos retornam `{ ok: true, data } | { ok: false, error }`. Wrapper `wrapAction()` aplicado (regra 33).

API Routes públicas (em `apps/web/app/api/i/[token]/route.ts`):

- `GET /api/i/[token]` — resolve invite-link, retorna metadados (empresa, módulos, profissional responsável, nome mascarado do paciente alvo) sem expor dados sensíveis; usado pela landing `/i/[token]`

## Schemas Drizzle (esperado)

Em `packages/db/schema/members.ts`:

- `members` — `id uuid pk`, `tenant_id uuid not null`, `person_id uuid not null` (FK `persons` do Sprint 01a — fornece nome, documento, email, phone, endereço, birth_date, sex), `company_id uuid not null`, `home_unit_id uuid`, `family_history jsonb nullable` (array de condições familiares — diabetes, hipertensão, câncer, etc; usado por Fisio Sprint 20 e Nutri Sprint 29 na anamnese), `archived_at timestamptz nullable`, timestamps. Índices: `(tenant_id, company_id)`, `(tenant_id, person_id)` unique (mesma pessoa não vira 2 members no mesmo tenant), `(tenant_id, archived_at)`. Campos de identidade (nome/CPF/email/phone) vêm via JOIN com `persons` — view `v_members_full` materializa leitura quente.
- `member_events` — `id`, `tenant_id`, `member_id`, `actor_user_id`, `kind` enum, `payload jsonb`, `at timestamptz`. Append-only (trigger proíbe UPDATE/DELETE). **Particionado por TRIMESTRE desde dia 1** (ADR 0072 + regra 34); `@volume_estimate_yearly: 10M+`; retenção 3 anos raw, depois agrega para `member_events_summary_quarterly` (preserva insights longo prazo); jobs `create-next-partitions` quadrimestrais
- `member_notes` — `id`, `tenant_id`, `member_id`, `author_user_id`, `body text`, `visibility` enum, timestamps. **Marcadas como Nível 5 — nunca cruzam tenant via vínculo (regra 42).**
- `member_tags` — `tenant_id`, `member_id`, `tag text`. PK composta `(tenant_id, member_id, tag)`.

Em `packages/db/schema/passport.ts` (ADR 0077):

- `patient_module_types` — lookup table extensível: `key text pk`, `label_pt_br/en_us/es_419 text`, `regulatory_body text` (CONFEF/COFFITO/CFN/null), `default_data_level int`, `active bool`. Seed MVP: 5 módulos.
- `patient_invites` — `id`, `token unique`, `tenant_id`, `company_id`, `requested_by_user_id`, `target_name`, `target_cpf`, `target_phone`, `target_email`, `requested_modules jsonb`, `expires_at` (now + 7d), `accepted_at`, `cancelled_at`, `created_at`. Índices: `(token)`, `(tenant_id, target_cpf)`, `(expires_at)` para janitor.
- `patient_company_links` — `id`, `person_id` (FK persons, sem tenant_id direto), `tenant_id`, `company_id`, `status` enum, `requested_by_user_id`, `requested_at`, `responded_at`, `expires_at` (now + 12m), `paused_until`, `revoked_at`. Unique `(person_id, company_id)`. RLS via `EXISTS (... tenant_id = jwt.tenant_id)`.
- `patient_link_modules` — `id`, `link_id` (FK CASCADE), `module_type` (FK module_types.key), `primary_user_id`, `data_level_max int default 3`, `granted_at`, `revoked_at`, `reason_revoked text`. Unique `(link_id, module_type)`.
- `patient_data_access_log` — `id`, `person_id`, `link_id`, `reader_user_id`, `reader_tenant_id`, `source_tenant_id`, `module_type`, `category text`, `resource_type text`, `resource_id uuid`, `read_at timestamptz`, `ip inet`, `request_id uuid`. **Particionado por mês** (regra 34). Append-only (trigger).
- `commercial_leads` — `id`, `lead_type` enum ('professional_invited_by_patient', 'company_invited_by_patient'), `name`, `cpf_or_cnpj`, `email`, `phone`, `invited_by_person_id`, `created_at`. Para path C convite inverso quando profissional não está no LogiFit.

Trigger `enforce_one_active_module_per_person` BEFORE INSERT/UPDATE em `patient_link_modules` valida constraint global. Função SQL `has_cross_tenant_access(reader_user_id, person_id, module_type, category)` retorna bool combinando: link ativo (não pausado/revogado/expirado) + módulo ativo + `data_level_max` cobre categoria.

**RLS em todas:** `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid` + predicados por scope de `user_roles` (ver padrão em [acesso-e-autorizacao.md](../acesso-e-autorizacao.md#camada-3--rbac-com-scope)). `patient_company_links` e `patient_link_modules` usam EXISTS subquery cobrindo cross-tenant via vínculo (regra 42).

## Eventos de domínio emitidos

Em `packages/types/events.ts`:

- `member.created` — `{ member_id, company_id, unit_id, by_user_id, at }`
- `member.updated` — `{ member_id, diff, by_user_id, at }`
- `member.archived` — `{ member_id, reason, by_user_id, at }`
- `member.transferred` — `{ member_id, from_company_id, to_company_id, by_user_id, at }`
- `member.note_added` — `{ member_id, note_id, visibility, by_user_id, at }`
- `patient.invite_sent` — `{ invite_id, tenant_id, company_id, target_cpf_masked, modules, by_user_id, at }`
- `patient.invite_accepted` — `{ invite_id, link_id, person_id, tenant_id, accepted_modules, at }`
- `patient.invite_recused` — `{ invite_id, target_cpf_masked, recused_modules, at }`
- `patient.linked` — `{ link_id, person_id, tenant_id, company_id, modules, at }`
- `patient.module_substituted` — `{ person_id, module_type, old_link_id, new_link_id, at }`
- `patient.link_paused` / `patient.link_revoked` — `{ link_id, person_id, by, at }`
- `patient.signed_up_proactive` — `{ person_id, signup_path: 'proactive', at }` (path B)

Consumidores no MVP: timeline UI via Realtime (mesmo tenant). Fase 2+ (cross-alert) consome via subscriber. **Sprint 11 (Prescrições) consome `patient.linked` para detectar conflito cross-prescrição cross-tenant.**

## Commit (checklist)

**Members core:**

- [ ] Schema Drizzle: `members`, `member_events` (append-only), `member_notes`, `member_tags`
- [ ] RLS em todas as tabelas novas, testada nos 4 cenários canônicos
- [ ] Zod schemas em `packages/types/members.ts`
- [ ] Server Actions com retorno padronizado
- [ ] Eventos publicados em `domain_events` + Realtime
- [ ] Páginas `/app/members/*` com tokens "Equilíbrio Vital"
- [ ] Layout de home do member `/app/members/[id]` com grid de widgets; slots padrão do MVP: `overview`, `agenda`, `financeiro`, `copilot`, `acessos` (+ previsão de slots futuros `prontuario`, `evolucao`, `antropometria`, `alimentar`)
- [ ] Registry em `packages/ui/members/registry.ts` exportando `registerMemberWidget(meta)` e `getWidgetsForSlot(slot, ctx)`
- [ ] Componente `<MemberWidgetSlot name="..." member={...} />` que lê do registry e filtra por 4 gates: `requiredPermissions` (role) · `requiredVertical` (tenant tem vertical ativa) · `showWhen(member)` (presença de dados) · `consentPurpose` (consent ativo quando cross-module). Ver [modulos.md — modelo de visibilidade](../modulos.md#dashboard-do-member--modelo-de-visibilidade-de-widgets)
- [ ] Registrar widget inicial do slot `overview`: `{ slot: 'overview', component: OverviewWidget, requiredPermissions: ['member.read'], requiredVertical: null, consentPurpose: null, showWhen: () => true }`
- [ ] Teste e2e: recepção vê `overview`; fisio (sem `member.read` em escopo do member) não vê; widget fantasma de slot vazio não renderiza espaço
- [ ] Seed: 5 members por cenário canônico
- [ ] Testes unit (Vitest) em `members/actions.test.ts`
- [ ] Teste E2E Playwright: isolamento tenant/scope
- [ ] Feature flag `crm_v1` (PostHog)
- [ ] ADR 0011 publicado

**Passaporte cross-tenant (ADR 0077 — regra 42):**

- [ ] Schema Drizzle: `patient_module_types` (lookup) + seed dos 5 módulos · `patient_invites` · `patient_company_links` · `patient_link_modules` · `patient_data_access_log` (particionado mês) · `commercial_leads`
- [ ] Função SQL `has_cross_tenant_access(reader_user_id, person_id, module_type, category) RETURNS bool`
- [ ] Trigger `enforce_one_active_module_per_person` BEFORE INSERT/UPDATE em `patient_link_modules`
- [ ] Trigger append-only em `patient_data_access_log` (nega UPDATE/DELETE)
- [ ] Job `create-next-partitions` mensal pra `patient_data_access_log`
- [ ] Server Actions de invite (`sendPatientInvite`, `resendPatientInvite`, `cancelPatientInvite`, `acceptPatientInvite`, `confirmModuleSubstitution`, `pauseLink`, `revokeLink`, `requestProvider`, `setSharingLevel`, `setCategoryGrant`, `getCrossTenantSummary`)
- [ ] Server Actions de cadastro proativo (`signupPatient`, `requestSmsCode`, `confirmSms`)
- [ ] API Route `GET /api/i/[token]` (resolve invite-link metadata)
- [ ] Rate limit: 50 invites/dia/tenant + 3 invites/CPF/30d (regra 36, tabela `packages/security/rate-limits.ts`)
- [ ] Job janitor `expire-stale-invites` (Vercel Cron diário)
- [ ] Páginas backoffice: `/app/invites` (lista pedidos enviados pelo tenant)
- [ ] Páginas portal paciente: `/meu/dashboard`, `/meu/privacidade/compartilhamento`, `/meu/privacidade/acessos`, `/meu/convidar`
- [ ] Páginas públicas: `/cadastro` (path B + Turnstile + SMS) · `/i/[token]` (landing invite com branch login/cadastro + confirmação anti-fraude por nome mascarado)
- [ ] Componente `<PassportSummary memberId>` no perfil `/app/members/[id]` mostra "vinculado em N empresas" + tab "Outras Empresas" (read-only, dados liberados por outros tenants)
- [ ] Lint custom `cross-tenant-read-must-log` em CI (regra 42)
- [ ] Comentário `// ai-blocked: nota privada do profissional Nivel 5` em `addNote` (regra 41 + 42)
- [ ] Provider WhatsApp configurado pra envio de invite (provisório — Twilio sandbox ou Z-API trial; ADR 0025 fecha provider definitivo no Sprint 13)
- [ ] Resend configurado pra email de invite + confirmação cadastro
- [ ] i18n: catalog completo nos 3 locales para todas as strings de invite/passport (regra 27)
- [ ] Testes E2E Playwright nos 3 viewports (regra 31):
  - Path A: profissional cria invite → paciente recebe → cria conta → aceita parcial → vínculo ativo → leitura cross-tenant gera log
  - Path B: paciente proativo cria conta → recebe invite → aceita
  - Path C: paciente proativo busca empresa → cria pedido inverso → empresa aceita
  - Substituição: 2 vínculos no mesmo módulo → trigger bloqueia até confirmação
  - Limites duros: tenta ler `financial_transactions` cross-tenant → bloqueado; tenta ler `member_notes` cross-tenant → bloqueado
  - Anti-fraude: invite recebido por terceiro (CPF não bate) → bloqueia + alerta
  - Rate limit: 51º invite no dia → `RATE_LIMITED`
- [ ] Seed adicional: 3 vínculos cross-tenant pra paciente "Maria" (academia + fisio + nutri em tenants distintos) — usado em testes E2E e demos

## Stretch

- [ ] Merge de `members` duplicados (UI + audit trail)
- [ ] Importador CSV para migração de cliente

## Log

- —

## Definition of Done

- [ ] Feature flag `crm_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada nos 4 cenários
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 02 → `done`, item #4 → `done`
- [ ] Zero violação de regras

## Retro

- —
