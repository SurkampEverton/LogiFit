# Sprint 02 — Geral · CRM unificado (pessoas)

- **Área:** geral
- **Início:** planejado (depois do Sprint 01b)
- **Fim planejado:** +3 semanas
- **Status:** **done (02a + 02b + 02b2 + 02b3 + 02b4 + 02b5 + 02b6 + 02b7 + 02b8 + 02b9 + 02c partials)** 2026-05-18/21 — Faixas A+B+C (2026-05-12) + Path A (2026-05-18 — passport actions + landing invite + has_cross_tenant_access SQL fn) + Sprint 02b backbone Path B (2026-05-19 — Captcha+SMS providers + passport_signup_otps + /cadastro 2-step UI + signupPatient stub) + **Sprint 02b2 partial** (2026-05-19 — ADR 0093 Accepted + schema passport_global_identities + signupPatient real substitui stub + helpers password-hash scrypt + recovery-codes Crockford SHA-256) + **Sprint 02b3 partial** (2026-05-19 — envelope encryption recovery codes ativo + tests password/recovery/captcha/sms-otp/totp 121 verdes + member-session bridge + Path A+B híbrido auto-accept invite + ADR 0094 Accepted + schema passport_global_sessions + helper passport-session + /meu/login Form email+password 2-tabs + loginPassport SA + cron expire-passport-global-sessions + wizard MFA TOTP RFC 6238 standalone + loginPassport TOTP real) + **Sprint 02b4 partial** (2026-05-19/20 — wrapPassportAction helper + /meu suporta passport+member sessions + /meu/perfil 5 SAs passport+4 forms UI + helper auth-rate-limit 27 tests + gate loginPassport rate limit + cron hard-delete-deactivated-passport LGPD 30d + QR code visual MFA lib qrcode server-side ADR 0095) + **Sprint 02b5 partial** (~2026-05-20 — `dispatchEmailVerification` helper compartilhado + `resendPassportEmailVerification` SA + UI button + cron `expire-passport-email-verification-tokens` daily + `change-email` + `resend-verification` E2E specs + fix middleware `/meu/*` aceita cookie passport OR member) + **Sprint 02b6 partial** (~2026-05-20 — helper `requireMemberOrPassport` + `PassportNeedsLink` + 20 pages `/meu/*` migradas + smoke E2E 24 rotas + split `meu-portal-routes` em passport vs member suites + treino migrate 45/45) + **Sprint 02b7 partial** (2026-05-20 — ADR 0098 Accepted: feature flags MVP self-host + schema `feature_flags` + helper `isFeatureEnabled` cache 60s + 14 flags canônicas seedadas + gate em `signupPatient`) + **Sprint 02b8 partial** (2026-05-20/21 — runbook setup credentials passport_signup_v1 Brevo+Twilio+Turnstile + clarify Twilio NÃO grátis + botão WhatsApp no email confirmação + `sendPatientInvite` dispatch automático email + WhatsApp + retorna 3 canais (email + WhatsApp staff + copy link) + ADR 0099 WhatsApp Nível 1 wa.me link + nome do profissional emissor no email de invite + UI `/app/passport/invites/new` 3 canais resultado + fix(auth) trustedOrigins+APP_URL Invalid origin + fix(auth) plug @repo/email no magic link) + **Sprint 02b9 partial** (2026-05-21 — `/app/passport` landing + `/app/passport/invites` lista filtrável + `InviteRowActions` client island copy-link+WhatsApp share + breadcrumb /new + form `/pessoas/new` ganha todos os campos do schema PF/PJ + endpoint `GET /api/cep/{cep}` autofill ViaCEP via safeFetch regra 37 + fix root cause `unrecognized configuration parameter app.tenant_id` em 5 INSERTs + fix CNPJ orchestrator fallback em NOT_FOUND ADR 0048 revisão) + **Sprint 02c partial** (2026-05-21 — Faixa D parcial `/pessoas/new` ConfirmDialog CNPJ inativo + toast.fromApiError regra 45 + revogação inline `/invites` cancelPatientInvite/revokePatientLink via Confirm/PromptDialog + filtros adicionais `?q=` busca nome + `?module=` 5 opções + `?responsible=<userId>` dropdown DISTINCT users hard-cap 200 + paginação cursor base64url `{createdAt,id}` PAGE_SIZE=25 com Carregar mais → / ← Voltar ao início + drill-down `/invites/[id]` Server Component com header+contato+módulos com responsável JOIN professional_registrations + dataLevels badges + timeline cronológica derivada timestamps + histórico de acessos cross-tenant via patient_data_access_log regra 42 hard-cap 50). Sprint 02 fechamento restante (futuro): **02c.4** schema dedicado `patient_link_events` particionado (sprint dedicado: migration + RLS + helper + INSERT em 6-8 SAs + UPDATE timeline); **02c.5** Redis sliding window real (BLOQUEADO depende Sprint 00 infra); **02c.6** LocaleSwitcher `/pessoas/new` (BLOQUEADO depende sprint i18n migration cross-app).
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
  - [ ] **Função SQL `has_cross_tenant_access(p_reader_user_id uuid, p_patient_person_id uuid, p_module_type text, p_category text)`** implementada em `packages/db/functions/has-cross-tenant-access.sql`. Lógica:
    1. Resolver `reader_tenant_id` via JWT claim do reader
    2. Resolver `source_tenant_id` via `patient_person_id` (tenant onde o paciente é cadastrado primariamente)
    3. Se `reader_tenant_id = source_tenant_id` → return TRUE (intra-tenant, sem regra 42)
    4. SELECT em `patient_company_links` WHERE `patient_person_id = p_patient_person_id AND tenant_id = p_reader_tenant_id AND status = 'active' AND revoked_at IS NULL` — se vazio return FALSE
    5. JOIN com `patient_link_modules` WHERE `module_type = p_module_type AND active=true AND revoked_at IS NULL` — se vazio return FALSE
    6. Verificar que `data_level_max` (1-5) cobre `p_category` (Identidade=1, Antropometria=2, Treino=3, Clínico=4, Workspace=5; Workspace nunca cruza independente do max) — se `p_category=5` ou `data_level_max < requiredLevel(p_category)` return FALSE
    7. Verificar limites duros (financeiro/Nível 5/prontuário CFM original/dado de outras pessoas) — se `p_category` pertence à lista, return FALSE
    8. Return TRUE
  - [ ] Testes SQL em `packages/db/tests/has-cross-tenant-access.test.ts` cobrindo 6 cenários:
    1. Intra-tenant (mesmo tenant) → TRUE
    2. Cross-tenant com vínculo ativo + módulo + nível coberto → TRUE
    3. Vínculo revogado → FALSE
    4. Módulo não autorizado → FALSE
    5. Categoria fora do `data_level_max` → FALSE
    6. Categoria em limite duro (financeiro) → FALSE
  - [ ] **Lint custom `cross-tenant-read-must-log`** (regra 42) em Biome — bloqueia commit se Server Action lê tabela clínica/antropométrica/prescritiva/plano de tenant diferente do reader sem chamar `has_cross_tenant_access()` + grava em `patient_data_access_log`; exceção via `// cross-tenant-exempt: <motivo + ADR>` (raro)
  - [ ] **RIPD `docs/compliance/ripd/v1.0-passaporte-paciente.md`** publicado e assinado pelo DPO antes do feature flag passaporte ir a produção (regra 29 + ADR 0054); CI bloqueia se módulo passaporte ativo sem RIPD vigente. RIPD atual está com parecer **"Aceito com restrições"** (linha 10) — restrições ainda pendentes: (a) revisão jurídica externa antes do primeiro tenant clínico ativar; (b) primeiro tenant clínico só ativa após **30 dias de operação MVP estável** sem incidentes (linha 117 do RIPD). Marcar este sub-item resolvido só após cumprir as 2 restrições.
  - [ ] Entrada em `docs/compliance/lgpd-data-inventory.md` para `patient_data_access_log` confirmada (já presente)

## Decisões tomadas / ADRs esperados

- **[ADR 0011](../decisions/0011-member-perfil-unico-cross-module.md)** (Accepted — 2026-05-12) — Member como perfil único cross-module + timeline em `member_events` append-only. Tabelas específicas da vertical (prontuário fisio, antropometria nutri) referenciam `member_id` mas nunca duplicam dados básicos.
- **[ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)** — Passaporte do paciente cross-tenant + Modelo C híbrido (vínculo empresa + módulos explícitos) + 5 módulos canônicos lookup table + 2 paths de cadastro (reativo/proativo) + 5 níveis de dados + audit obrigatório. **Status: Accepted** (decisão arquitetural formalizada 2026-04-25 — schema, fluxos, gates podem ser implementados). **Gate operacional separado:** ativação do feature flag `passaporte_cross_tenant` em tenant clínico (médico/fisio com CFM/COFFITO) depende de parecer jurídico externo + 30d de operação MVP estável (RIPD `v1.0-passaporte-paciente.md` linhas 10/117). Implementar e mergir desbloqueado; ligar em produção bloqueado pelo gate.
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
- [ ] RLS em todas as tabelas novas, testada nos 5 cenários canônicos
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

- **2026-05-21 — Sprint 02c partial entregue (5 commits — `done (02c partial)`).** Fecha loop UX do passaporte cross-tenant: revogação inline, filtros adicionais, paginação cursor, drill-down de detalhe, histórico de acessos.
  - **Faixa D parcial `/pessoas/new`** (commit `df25090`):
    - `<ConfirmDialog>` (regra 45) bloqueia submit quando `autoFilled.situacao !== 'ativa'`. Reusa `confirm()` de `@repo/ui/messages` (padrão `deactivate-account-form`).
    - `toast.fromApiError` substitui `submitError` inline. Envelope ApiError (ADR 0071) vai pra toast.error/critical conforme severity com `request_id` como description.
  - **Revogação inline `/invites`** (commit `8deebfa`):
    - Botão "Cancelar convite" em `pending` chama `cancelPatientInvite` com `<ConfirmDialog>`.
    - Botão "Revogar vínculo" em `active` chama `revokePatientLink` com `<PromptDialog>` pedindo motivo (validator 2-500 chars).
    - `toast.success`/`fromApiError` + `router.refresh()` pós-sucesso.
    - `<InviteRowActions>` aceita props `inviteId` + `status` + `patientName`.
  - **Filtros adicionais `/invites`** (commit `f3f938c`):
    - `?q=<nome>` busca ILIKE substring em `persons.name`, mín. 1/máx. 80 chars, metachars `%` e `_` strip-ados anti-wildcard injection.
    - `?module=academia|personal_training|fisioterapia|nutricao|pilates` filtra via EXISTS subquery em `patient_link_modules`.
    - `?responsible=<userId>` (Sprint 02c.2) dropdown com DISTINCT responsáveis do tenant via JOIN users+persons, hard-cap 200, EXISTS subquery por `responsible_professional_user_id`.
    - Pills de status preservam q+module+responsible ao trocar de aba via `buildFilterUrl()` helper.
    - Botão "Limpar" aparece quando há filtros ativos.
  - **Paginação cursor-based `/invites`** (Sprint 02c.1, commit `ef5065e`):
    - Cursor base64url JSON `{createdAt, id}` substitui hard-cap 100.
    - SQL `WHERE (l.created_at, l.id) < ($5, $6)` + `ORDER BY DESC, DESC` + `LIMIT PAGE_SIZE+1` detecta próxima página sem COUNT extra.
    - PAGE_SIZE = 25; UI "Carregar mais →" e "← Voltar ao início".
    - Cursor inválido (b64/JSON/UUID/data) ignora silenciosamente e mostra primeira página.
  - **Drill-down `/invites/[id]`** (commit `26d3e17`):
    - Page Server Component novo: header com badge status + auto-cadastro + InviteRowActions; seção Contato (email/telefone/documento); seção Módulos (cards com responsável técnico JOIN `professional_registrations` + dataLevels badges + timestamps individuais); seção Linha do tempo cronológica derivada dos timestamps existentes.
    - Validação UUID regex local antes da query (404 limpo); RLS `WHERE l.id = $1 AND l.tenant_id = $2`.
    - Lista (`page.tsx`) ganha link "Detalhes →" no canto direito + nome do paciente vira link clicável.
  - **Histórico de acessos cross-tenant `/invites/[id]`** (Sprint 02c.3, commit `ef5065e`):
    - Seção nova abaixo da timeline lista `patient_data_access_log` filtrado por `source_tenant_id = sessão` + `passport_passport_id = link.passport_id`. RLS de `0012_passport_rls.sql` permite SELECT quando tenant é reader OR source.
    - LEFT JOIN best-effort em tenants/users; se RLS bloquear tenant externo → uuid truncado na UI.
    - Tabela: data/hora · tenant leitor · usuário · módulo·categoria · recurso · request_id (todos uuids truncados pra readability).
    - Hard-cap 50 entradas mais recentes; paginação dedicada Sprint 02d+.
  - **Sprint 02c restante (não implementado nesta sessão):**
    - **02c.4 schema `patient_link_events`** — AVALIADO mas não implementado. Requer schema + migration + RLS + helper `recordLinkEvent()` + INSERT em 6-8 SAs (`createPatientInvite`/`sendPatientInvite`/`acceptInvite`/`cancelPatientInvite`/`revokePatientLink`/`activateModule`/`deactivateModule`) + UPDATE da timeline pra usar a tabela com fallback. Fazer parcialmente (só nas 2 SAs que toquei: cancel/revoke) deixa histórico inconsistente — pior que manter timeline derivada de timestamps. Flagar pra sprint dedicado (02d?).
    - **02c.5 Redis sliding window real** — BLOQUEADO. Depende Sprint 00 materializar Redis container self-host. Sem infra Redis em dev local rodando, implementação não é testável. Follow-up Sprint 00.
    - **02c.6 LocaleSwitcher `/pessoas/new`** — BLOQUEADO. Aplicação inteira tem strings hardcoded; migrar apenas `/pessoas/new` pra `t()` quebra consistência. Requer sprint dedicado de i18n migration cross-app (regra 27 enforce).
  - **Validação:** typecheck 12/12 + biome clean nos 4 arquivos tocados (`pessoas/new/new-person-form.tsx`, `passport/invites/page.tsx`, `passport/invites/invite-row-actions.tsx`, `passport/invites/[id]/page.tsx` novo).

- **2026-05-21 — Sprint 02b9 partial entregue (4 commits — `done (02b9 partial)`).** UX hardening do passaporte cross-tenant + form pessoas + fixes que destravavam cadastro real.
  - **Passaporte ganha hub navegável** — antes só existia `/app/passport/invites/new` (criar). Agora:
    - `/app/passport` — landing com 4 stat cards (Pendentes / Ativos / Revogados / Módulos ativos) + breakdown de vínculos ativos por módulo (academia/personal/fisio/nutri/pilates) + atalhos pra criar/listar invites. Empty state com CTA pra primeiro convite.
    - `/app/passport/invites` — lista filtrável por status (`?status=pending|active|revoked|all`), badge color-coded, módulos solicitados com responsável técnico, `creation_path=proactive` marcado quando paciente se cadastrou sozinho (Path B), e `InviteRowActions` (client island) com copy-link + share WhatsApp pra `pending`. Fallback graceful regra 45 quando clipboard API indisponível (input read-only + seleção automática, sem `window.prompt`). Hard-cap 100 linhas; paginação cursor e revogação inline ficam pra 02c+.
    - Breadcrumb de `/new` ajustado pra navegar de volta pra lista.
    - RLS defesa em profundidade: `set_config('app.tenant_id')` antes do SELECT + filtro explícito `WHERE l.tenant_id = $1`.
  - **Form `/app/pessoas/new` ganha todos os campos do schema** (`apps/web/app/app/pessoas/new/new-person-form.tsx`):
    - Antes cobria só CPF/CNPJ + Nome + Email + Telefone. Schema `persons` (ADR 0047) já tinha `displayName`, `birthDate`, `sex`, `address` completo e `notes`, mas só `address` chegava preenchido (via auto-fill CNPJ) — invisível, operador não tinha como completar PF.
    - 4 seções: Identidade (kind-aware: "Razão Social" vs "Nome completo"; `displayName` alterna "Nome fantasia" / "Apelido"), Contato, Endereço completo, Observações.
    - `birthDate` (date input) e `sex` (texto livre LGPD art. 11) só aparecem quando documento = CPF.
    - Auto-fill CNPJ expandido pra também popular CEP/número/complemento.
    - Schema Zod da action `createPerson` já aceitava todos os campos — só faltava expor na UI.
  - **Endpoint novo `GET /api/cep/{cep}`** (`apps/web/app/api/cep/[cep]/route.ts`):
    - Proxia ViaCEP (gratuito, sem chave) via `safeFetch` com `allowedHosts` estrita (regra 37).
    - Mapeia campos canônicos pro shape do `persons.address` jsonb.
    - Códigos de erro: `CEP_INVALID`, `CEP_NOT_FOUND`, `CEP_PROVIDER_DOWN`, `CEP_PROVIDER_ERROR`. `UNAUTHORIZED` se sem sessão.
    - Sem cache server-side (ViaCEP já tem CDN agressivo). Se virar gargalo, embrulha em `@repo/cep` análogo a `@repo/cnpj`.
    - UX no form: blur dos 8 dígitos dispara fetch + preenche só campos vazios (respeita digitação do operador).
  - **Fix root cause "Erro interno; estamos investigando"** que travava cadastro de pessoa/member/nota/tag/registro profissional:
    - `createPerson`, `createMember`, `addNote`, `addTag`, `createRegistration` lançavam `unrecognized configuration parameter "app.tenant_id"`. Causa: `withSessionContext` reserva um `PoolClient` e seta `app.tenant_id` nele, mas `db.insert(...)` do Drizzle pega outra conexão do pool — sem o setting.
    - Fix mínimo: passa `ctx.session.logifit.tenantId` literal nos 5 INSERTs em vez de depender do `current_setting()`. RLS continua satisfeita (role `postgres` dev tem `BYPASSRLS=t`).
    - Refactor estrutural (Drizzle-em-tx via AsyncLocalStorage pra `db.insert()` herdar o cliente da sessão) fica como follow-up — comentário `// why:` em `pessoas/actions.ts` documenta o débito técnico.
  - **Fix lookup CNPJ pra empresas reais** — orquestrador (`packages/cnpj/src/orchestrator.ts`) agora aciona fallback ReceitaWS também em `CNPJ_NOT_FOUND`, não só `PROVIDER_DOWN`/`RATE_LIMITED`:
    - Caso real que invalidou pressuposto "NOT_FOUND é definitivo": `33.009.911/0041-26` (SOUZA CRUZ filial 0041, ATIVA desde 1993) → BrasilAPI 404 + ReceitaWS 200. BrasilAPI tem snapshot incompleto pra filiais altas.
    - `CNPJ_INVALID` continua sem fallback (formato local, não problema de provider).
    - Custo: 1 request extra ReceitaWS por CNPJ verdadeiramente inexistente. Mitigado por cache 7d cobrindo ~95% dos hits.
    - [ADR 0048](../decisions/0048-busca-cnpj-provider-abstrato.md) atualizado com seção "Revisão 2026-05-21".
  - **Validação:**
    - ✓ typecheck 12/12 packages (cache verde + @app/web cache miss verde)
    - ✓ biome check 9 arquivos modificados clean (organizeImports + format + 3 fixes lint reais: `useConst` em `let counts`, `noUnusedImports` em `and`, `noUnusedTemplateLiteral` em template SQL fixo)
  - **02b9+ pendente** (próximas iterações antes de promover Sprint 02 a `done`):
    - Faixa D fechamento `/pessoas/new`: `<PromptDialog>` confirmação CNPJ suspenso/baixado (regra 45), `toast.fromApiError` em erros de submit, `LocaleSwitcher` no form
    - Passaporte: paginação cursor-based em `/invites` (atual hard-cap 100), filtro por módulo + responsável, revogação inline (chama `cancelPatientInvite`), drill-down `/invites/[id]` com timeline de eventos

- **2026-05-19 — Sprint 02b4 partial entregue (5 commits — `done (02b4 partial)`).**
  - Sessão anterior (commits b9754d6/eaa5393/0c37a9a/7057d2d) entregou: wrapPassportAction helper canônico (128l com overload schema/no-schema + opt-in MFA gate + lint reconhece wrap(Server|Member|Passport)?Action regex) + /meu suporta passport+member sessions via getActiveSession discriminated union + /meu/perfil refactor 2-branch (kind='passport' renderiza dados + 5 forms passport vs kind='member' preserva Sprint 26 legacy) + 5 SAs em apps/web/app/meu/perfil/passport-actions.ts (changePassword + regenerateRecoveryCodes + revokeMyPassportSession + deactivateAccount com mfaMaxAgeMs 5min + listMyPassportSessions read-only) + 4 forms client (ChangePasswordForm + RegenerateRecoveryCodesButton + PassportSessionRevokeButton + DeactivateAccountForm com email confirmation anti-clique-acidental).
  - **Sessão atual** (commits pendentes): fecha 3 gaps Sprint 02b4 sem credentials externas:
    - **Helper `auth-rate-limit.ts` em `@repo/security`** (155l + 27 unit tests cobrindo 9 sub-suites). Constantes ADR 0073 camada 2 canônicas (15min window / 5 falhas / 30min lockout / 3 IP captcha). Pure functions testáveis sem DB (`countRecentFailures`/`shouldLockout`/`shouldRequireCaptcha`) + I/O layer (`recordAuthAttempt` tolerante + `checkAuthLockout` por email OR ip + `evaluateLockout` Promise.all email+ip queries + idempotent INSERT lockout). PoolLike interface facilita mock testing. Total tests @repo/security **148 verdes** (era 121 → +27).
    - **Gate em `loginPassport`** (apps/web/app/meu/login/actions.ts): etapa 0 pre-check lockout → RATE_LIMITED com retry-after em min; recordAuthAttempt em 5 paths (success + `unknown_email` / `user_disabled` / `wrong_password` / `mfa_failed`); evaluateLockout via helper interno `recordFailure(reason)` em falhas; `MFA_RECENT_REQUIRED` exempted (paciente vai retornar com TOTP). Helper novo `apps/web/app/lib/request-ip.ts` (`getClientIp` precedência CF→Caddy→XFF→unknown sentinel). Wrap-exempt comment compactado em 1 linha (lint só olha 1 linha acima — ajuste mecânico).
    - **Cron `hard-delete-deactivated-passport`** (apps/web/app/api/jobs/hard-delete-deactivated-passport/route.ts): daily ~03:50 UTC (após expire-passport-global-sessions reduz contention). DELETE identities WHERE `deactivated_at < now() - 30 days` (LGPD art. 18 VI + janela reativação 30d documentada no SA `deactivateAccount`). FK CASCADE limpa sessions automaticamente; persons bridge orfã (FK nullable sem `.references()` constraint, design ADR 0093 — dado clínico tenant-scoped persiste 20a Lei 13.787). Auth `Bearer $CRON_SECRET` via `timingSafeEqual` mesmo padrão `expire-passport-global-sessions`. Retorna count + log JSON estruturado.
  - **Validação:**
    - ✓ typecheck 11/11 packages
    - ✓ lint-custom 743 + 2 css clean (9 rules)
    - ✓ docs-check 0/0
    - ✓ tests @repo/security 148 verdes (era 121 — +27 auth-rate-limit)
  - **Sprint 02b4 fechamento restante** (precisam credentials externas ou trabalho longo):
    - Email confirmação via `@repo/email` ([Brevo](../decisions/0096-email-brevo-substitui-aws-ses.md) — ADR 0096 substitui AWS SES) → `email_verified_at` update + change_email flow
    - E2E Playwright fluxo completo signup → MFA setup → login com TOTP + lockout enforcement
    - Feature flag `passport_signup_v1`
    - Redis sliding window real (regra 36 completa) substituindo auth_attempts polling

- **2026-05-20 — Sprint 02b4 partial — QR code visual MFA ([ADR 0095](../decisions/0095-qrcode-lib-mfa-totp.md)).**
  - **ADR 0095 Accepted** — lib `qrcode` justificada pela regra 46 (alternativa SVG Reed-Solomon próprio rejeitada por complexidade e risco operacional em UX de segurança crítica). Render **server-side** em Server Action → SVG injetado no HTML via `dangerouslySetInnerHTML`. **Zero bundle JS no client**.
  - **Wrapper isolado** `apps/web/app/lib/qr-code.ts` — `generateTotpQrSvg(uri)` única função exposta, error correction M (15%), margin 1, width 200px, preto/branco puros (REQUISITO do algoritmo QR — `// design-token-exempt:` aplicado em wrapper). Outros usos (boletos, contratos) exigem extensão deliberada do wrapper — proibido import direto de `qrcode` em outros arquivos.
  - **`enrollTotp` Server Action** ganha `qrSvg: string` no envelope além de `secret` + `uri`.
  - **Wizard `/cadastro/mfa-setup` step `scan`** renderiza QR visual centralizado em wrapper branco + fallback "digite o secret manualmente" + `<details>` colapsado com URI otpauth:// pra debug.
  - **Deps:** `qrcode@^1.5.4` + `@types/qrcode@^1.5.5` (devDep) — 30 packages add via pnpm.
  - **Validação:** typecheck 11/11 + lint-custom 744 + 2 css clean (9 rules) + docs-check 0/0 + tests @repo/security 148 verdes.

- **2026-05-19 — Sprint 02b3 partial entregue (6 commits — `done (02b3 partial)`).**
  - **ADR 0093 + 0094 Accepted** — 2 decisões arquiteturais que destravaram implementação:
    - [ADR 0093](../decisions/0093-passport-global-identities.md) — tabela `passport_global_identities` separada como pivot global do paciente (opção C de 4 avaliadas; A=tenant pivot fixo, B=tenant_id nullable, D=BetterAuth global todas REJEITADAS)
    - [ADR 0094](../decisions/0094-passport-global-sessions.md) — tabela `passport_global_sessions` dedicada com cookie `lf_passport_session` separado (opção A de 4; B=member_sessions nullable, C=bifurcação view, D=BetterAuth REJEITADAS)
  - **Schema novo `passport_global_identities`** (migration `0044_passport_global_identities.sql` + policy `0057_*.sql` FORCE RLS + self-select via `app.passport_global_id`):
    - Identidade global SEM tenant_id; campos: name + cpf_normalized UNIQUE + email UNIQUE (lower) + phone E.164 + email/phone_verified_at + birth_date + sex + password_hash scrypt + mfa_totp_secret_encrypted AES-256-GCM + recovery_codes_encrypted + accepted_terms/privacy_at + ripd_version_signup + signup_path + signup_ip + signup_otp_id FK + lifecycle (last_login_at, deactivated_at)
    - ALTER `persons` ADD nullable `passport_global_identity_id` FK bridge
    - 5 indexes: UNIQUE cpf + UNIQUE lower(email) + phone + partial active + signup_otp_id
  - **Schema novo `passport_global_sessions`** (migration `0045_*.sql` + policy `0058_*.sql` GRANT-only — auth table sem RLS, padrão member_sessions ADR 0088):
    - id + passport_global_identity_id FK CASCADE + refresh_token_hash UNIQUE SHA-256 + expires_at 30d + device_label + ip + mfa_verified_at + last_seen_at + revoked_at + revoked_reason (`user_logout` / `admin_revoke` / `password_change` / `mfa_change` / `session_rotation` / `expired`)
    - 4 indexes: UNIQUE hash + identity (created_at DESC) + partial active (revoked IS NULL) + partial cleanup
  - **4 helpers novos em `packages/security/src/`** (zero deps externas — regra 46 OK):
    - `password-hash.ts` (130l): scrypt Node nativo OWASP 2024 params (N=16384, r=8, p=1, keylen=64, salt=32) + `hashPassword`/`verifyPassword` constant-time + `needsRehash` rotação gradual — 15 unit tests
    - `recovery-codes.ts` (130l): `generateRecoveryCodes(n=10)` alfabeto Crockford reduzido (sem I/L/O/U) ~58 bits per code + `hashRecoveryCode` SHA-256 + `findUnusedMatchingCode` constant-time scan anti-timing-leak + `markRecoveryCodeUsed` imutável + `countAvailableRecoveryCodes` — 26 unit tests
    - `totp.ts` (180l): TOTP RFC 6238 standalone via `node:crypto` HMAC-SHA1 — `generateTotpSecret()` 20 bytes random base32 + `verifyTotp(token, secret, opts)` window ±1 step constant-time + `generateTotpUri(secret, account, issuer)` otpauth://totp format compatible Google Auth/Authy/1Password/Bitwarden — 17 unit tests
    - Tests `captcha.test.ts` (9) + `sms-otp.test.ts` (22) preenchem gap Sprint 02b backbone
    - Total @repo/security **121 tests verdes** (era 32 antes da sessão)
  - **`signupPatient` real** substitui stub Sprint 02b backbone (apps/web/app/cadastro/actions.ts):
    1. Re-valida OTP anti-replay (used_at < 30d + phone match)
    2. CPF normalizado 11 dígitos
    3. Detecta duplicação CPF/email (anti-enumeration genérico)
    4. `hashPassword` scrypt
    5. Se `enableMfa=true`: `generateRecoveryCodes(10)` + hash + **`encryptSecret` LOGIFIT_DATA_KEY ADR 0073** (envelope encryption ativa — sem mais TODO mfa-exempt)
    6. INSERT identity com signup_path canônico (`proactive` / `proactive_then_invite`)
    7. **Path A+B híbrido**: se `inviteToken` presente, `acceptInviteAfterSignup` helper interno cria persons espelho no tenant emissor com `passport_global_identity_id` FK + UPDATE link status=`active` + UPDATE modules status=`active`. Failure-tolerant.
    8. **Cria passport session automática** pós-INSERT — `createPassportSession` + `setPassportCookie` (paciente sai de `/cadastro` já logado)
  - **Helper `apps/web/app/lib/passport-session.ts`** (210l): `getPassportSession()`/`requirePassportSession(returnTo)`/`requirePassportMfa(claims, maxAgeMs)`/`createPassportSession(id, opts)`/`revokePassportSession(id, reason)`/`setPassportCookie`/`clearPassportCookie`/`withPassportContext` seta `app.passport_global_id` na conn (ativa RLS policy 0057)/`markPassportSessionMfaVerified` pós-TOTP
  - **Helper `apps/web/app/lib/active-session.ts`**: `getActiveSession()` orchestrator (passport first via cookie `lf_passport_session` → member fallback via cookie `lf_member_session` Sprint 26) retorna discriminated union `{kind: 'passport'|'member'}`. Migration path Fase 1-3 ADR 0094.
  - **Helper `member-session.ts` refactor**: `MemberSessionClaims` ganha optional `passportGlobalId` + `getMemberSession` JOIN persons resolve FK (Sprint 02b2 bridge) + `withMemberContext` seta `app.passport_global_id` quando claims tem valor
  - **UI `/meu/login` com 2 abas** (Sprint 26 magic link legacy + Sprint 02b3 Senha):
    - `page.tsx` Server Component resolve tenant slug via headers ADR 0065
    - `login-tabs.tsx` Client switcher Senha (default) / Magic link com underline ativo
    - `password-form.tsx` 2-step (credentials → mfa) — detecta `MFA_RECENT_REQUIRED` code + abre step TOTP
  - **Server Action `loginPassport`** (apps/web/app/meu/login/actions.ts):
    1. SELECT identity por `lower(email)` + `mfa_totp_secret_encrypted` — fail-closed em deactivated
    2. `verifyPassword` scrypt constant-time — anti-enumeration "Credenciais inválidas"
    3. Se `mfa_enrolled_at` setado: exige `totp` (sem → MFA_RECENT_REQUIRED frontend abre step) + `decryptSecret` + `verifyTotp` window ±1
    4. `createPassportSession` + `setPassportCookie`
    5. Update `last_login_at` fire-and-forget
    + `logoutPassport` tolerante (`getPassportSession` em vez de require — idempotente)
  - **Wizard MFA TOTP** `/cadastro/mfa-setup` — 3 Server Actions:
    - `enrollTotp()`: gera secret + cifra + grava `mfa_totp_secret_encrypted` (sem marcar `mfa_enrolled_at`) + retorna `{secret plain, uri otpauth://}`. Idempotente.
    - `confirmTotp({code})`: `decryptSecret` + `verifyTotp` + se OK marca `mfa_enrolled_at` + `generateRecoveryCodes(10)` + cifra + grava + `markPassportSessionMfaVerified`. Retorna 10 recovery codes plain (única chance).
    - `cancelTotpEnroll()`: limpa secret se não confirmou
  - UI wizard 3-step (Server Component `requirePassportSession` + Client `wizard.tsx`):
    - Step `init`: "Por que ativar MFA?" + botão "Começar setup" / "Pular"
    - Step `scan`: URI otpauth:// em `<pre>` (Sprint 02b4 renderiza QR via lib client) + secret manual formatted (grupos 4-4-4-...) + input código TOTP 6 dígitos
    - Step `done`: banner amarelo recovery codes + botão "Copiar todos" via `navigator.clipboard` + "Salvei → ir pra minha conta"
    - Cancel button `<ConfirmDialog>` regra 45 reusa Sprint 02c catálogo
  - **Cron `expire-passport-global-sessions`** (apps/web/app/api/jobs/): daily 03:35 UTC = 00:35 SP, `timingSafeEqual` auth + cleanup 2-fase (UPDATE expired→revoked preserva audit; DELETE revoked há >30d retention LGPD art. 18 V)
  - **wrapMemberAction audit log automático** (Sprint 02d3 — commit `7923969`): migration `0043_member_event_meu_kinds.sql` ADD VALUE 15 novos kinds `meu.*` (appointment.cancelled / session.revoked / consent.updated / cross_prescription_alert.acknowledged / incident.acknowledged / cross_tenant_access.exported / exam.self_uploaded / device.* 5x / diary.* 2x / mobile.* 2x). 21 SAs portal ativadas com `eventKind` — INSERT member_events fire-and-forget após handler success com `actor_user_id=NULL` (distingue de staff). `setAuditPayload` no context + sanitizeArgs redact PII.
  - **wrapMemberAction migration batch** (Sprint 02c2 + 02d-1 + 02d-2): 21 SAs do `/meu/*` migradas pra helper canônico — meu/actions.ts (6 SAs core), meu/exames (1), meu/dispositivos (8), meu/diario (4), meu/mobile (3 + 1 exempt pré-auth). 3 SAs pré-auth/tolerantes ficam com `// wrap-exempt:` (requestMagicLink + verifyMagicLink + logoutMember).
  - **Lint custom maturity** (Sprint 02c cleanup): cross-tenant-read-must-log REAL bidirecional (gate-sem-audit + audit-sem-gate ambos pegam — regra 42 enforcement ativo); docs/rules.md regra 42 atualizada com nota explícita; cleanup `no-window-alert` 4→0 + `no-hardcoded-design-token` 400→0 + `no-unwrapped-action` 29→0 (refinou regex + reconheceu padrão member portal). Lint 9/9 rules clean.
  - **Validação:**
    - ✓ typecheck 11/11 packages
    - ✓ lint-custom 733 + 2 css clean (9 rules)
    - ✓ docs-check 0/0
    - ✓ tests @repo/security 121 verdes (era 32 antes da sessão — +89)
    - ✓ 21 SAs portal com audit automático em `member_events`
  - **Sprint 02b3 fechamento restante** (precisam credentials externas ou trabalho longo):
    - Email confirmação via `@repo/email` ([Brevo](../decisions/0096-email-brevo-substitui-aws-ses.md) — ADR 0096 substitui AWS SES) → `email_verified_at` update
    - QR code visual render (lib `qrcode.js` ~30KB ou SVG próprio Reed-Solomon ~500l)
    - E2E Playwright fluxo completo signup proativo → MFA setup → login com TOTP → tenant linking
    - Feature flag `passport_signup_v1`
    - Rate limit Redis 5 attempts/IP/15min em `loginPassport` via `auth_attempts` Sprint 01a

- **2026-05-19 — Sprint 02b backbone Path B entregue (`done (02b backbone)`).**
  - 2 providers abstratos em `packages/security/src/`:
    - `captcha.ts` (95 linhas): `verifyCaptcha({token, remoteIp?})` retorna `{valid, provider, action?, errorCodes?}`. Estratégia: sem `TURNSTILE_SECRET_KEY` → mock dev (aceita qualquer token não-vazio); com → POST Cloudflare Turnstile siteverify; em prod sem secret → throw (config inválida). Inclui `// safe-fetch-exempt:` comment justificando — fetch direto pro endpoint canônico do provider.
    - `sms-otp.ts` (135 linhas): `generateOtpCode()` 6 dígitos via `crypto.randomInt`; `hashOtpCode(code)` SHA-256; `verifyOtpCode(plain, hash)` constant-time anti-timing; `sendSmsOtp({phone, code, locale?})` retorna `{sent, provider, messageSid?, errorMessage?}`. 3 templates SMS pt-BR/en-US/es-419 com warning "não compartilhe com ninguém". Estratégia: sem `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` → mock dev (loga código no console); com → POST Twilio Messages API com Basic auth; em prod sem credentials → throw.
  - Schema novo `passport_signup_otps` em `packages/db/src/schema/passport-signup.ts`:
    - Sem `tenant_id` nem `member_id` — pré-auth global (visitor anônimo)
    - Campos: id + phone (E.164) + code_hash (SHA-256) + expires_at + used_at + attempts (rate limit 5) + request_ip + sms_provider + sms_message_sid + created_at
    - 2 indexes: phone+created_at desc (lookup quente) + expires_at (cleanup cron)
    - Sem RLS — acesso direto via `pool.query` do Server Action pré-auth
    - Migration `0042_passport_signup_otps.sql`. Policy `0056_passport_signup_otps.sql` apenas GRANT (sem RLS).
  - 3 Server Actions em `apps/web/app/cadastro/actions.ts` (320 linhas) com `// wrap-exempt:` (pré-auth público visitor anônimo, sem session pra wrapServerAction):
    - `requestSmsCode({phone, captchaToken})` verifica Turnstile → invalida OTP ativo anterior do mesmo telefone → gera código + hash + envia SMS (mock dev) → persiste OTP. Anti-enumeration: validation errors silenciosos `{ok:true, sent:false}`. Em dev mock retorna `devOnlyCode` pro dev testar; NUNCA em prod.
    - `verifySmsCode({phone, code})` busca OTP mais recente → checa used_at/expires_at/attempts (max 5 → invalida) → `verifyOtpCode` constant-time → incrementa attempts em falha → marca used_at em sucesso. Retorna `{ok:true, otpId, phone}` pra próxima etapa.
    - `signupPatient({name, cpf, phone, email, password, smsOtpId, acceptedTerms, acceptedPrivacy, enableMfa, locale})` **STUB** — re-valida OTP usado recente (anti-replay; usedAge < 30d) + retorna `{ok:false, code:'SCHEMA_PENDING', message, plannedSchema:{decision:'opção C — passport_global_identities separada'}}` até ADR persons-without-tenant ser decidido.
  - UI público `apps/web/app/cadastro/`:
    - `page.tsx` Server Component (90 linhas) — header + invite banner quando `?invite=<token>` + form 2-step client + nota "O que você ganha" + nota warning "backbone Sprint 02b — completo em Sprint 02b2"
    - `cadastro-form.tsx` Client Component (260 linhas) com 4 steps (`phone` / `verify` / `details` / `done`):
      - Step phone: input E.164 + placeholder Turnstile widget + submit chama requestSmsCode
      - Step verify: input código 6 dígitos + banner amarelo "🛠 Modo dev: SMS provider em mock — código: XXXXXX" quando devOnlyCode presente
      - Step details: name + CPF + email + password + checkbox enableMfa + 2 checkboxes obrigatórios (acceptedTerms + acceptedPrivacy) + `<ConfirmDialog>` (regra 45 reusa Sprint 02c catálogo) antes do signup + mostra stub result quando ok=false
      - Step done: stub success card (acionado em Sprint 02b2 quando signup real)
  - **Resultado:**
    - ✓ typecheck 11/11
    - ✓ lint-custom 713 + 2 css clean (9 rules)
    - ✓ docs-check 0/0
    - ✓ tests @repo/security 32 verdes
  - **Sprint 02b2 (futuro) completa Path B**:
    - **ADR persons-without-tenant** — schema `persons.tenant_id` NOT NULL atual. 3 opções avaliadas no comment do file:
      - (A) tenant pivot fixo `system-passport-pivot` UUID seed
      - (B) refactor `tenant_id` pra nullable + RLS adaptado
      - (C) tabela `passport_global_identities` separada como pivot global ← preferência
    - Implementar `signupPatient` real conforme ADR — INSERT identity + hash senha (BetterAuth/Lucia decisão Sprint 01a sub) + opt-in MFA TOTP wizard + recovery codes
    - Cron `expire-passport-signup-otps` 24h cleanup (preserva used_at por 30d audit antes do delete permanente)
    - Provisionar Cloudflare Turnstile (site key + secret) + Twilio sandbox + envelope encryption credentials via `LOGIFIT_DATA_KEY` ADR 0073
    - Widget Turnstile real no client (carregar `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">`)
    - RIPD `docs/compliance/ripd/v1.0-passport-signup.md` (regra 29 + ADR 0054) com DPO sign-off antes de feature flag prod
    - Rate limit Redis 3 requests/IP/15min via `packages/security/rate-limits.ts` (regra 36)
    - WhatsApp OTP como segundo canal (Twilio WhatsApp Business API) com fallback se SMS falhar
    - E2E Playwright fluxo completo (Turnstile sandbox + Twilio test mode)
    - Feature flag `passport_signup_v1`
    - Quando paciente vier de `?invite=<token>`, vincular automaticamente após signup (Path A+B híbrido)

- **2026-05-18 — Fechamento Path A entregue (`done (02a core)`).**
  - Função SQL `has_cross_tenant_access(reader_user_id, reader_tenant_id, passport_id, module, category)` em `packages/db/src/policies/0055_has_cross_tenant_access.sql` retorna bool combinando: vínculo ativo + módulo ativo + data_levels cobre categoria + 4 limites duros sempre FALSE (`financeiro`/`prontuario_cfm_bruto`/`terceiros_mencionados`/`workspace`). STABLE, GRANT EXECUTE pra `logifit_app`. Caller padrão: Server Action chama antes de ler dado clínico cross-tenant + grava `patient_data_access_log` (lint `cross-tenant-read-must-log` enforça).
  - 11 testes SQL em `packages/db/tests/has-cross-tenant-access.test.ts` cobrindo 10+ cenários canônicos: vínculo ativo + módulo + nível → TRUE; vínculo revogado → FALSE; módulo inativo (substituído) → FALSE; categoria não autorizada em data_levels → FALSE; limite duro financeiro → FALSE; workspace nível 5 → FALSE; prontuario_cfm_bruto → FALSE; terceiros_mencionados → FALSE; categoria desconhecida fail-closed → FALSE; sem vínculo → FALSE; sanity TENANT_SOURCE — total 11 tests.
  - 8 Server Actions wrapped em `apps/web/app/app/passport/actions.ts` (520l):
    - `sendPatientInvite({passportPassportId, personId, modules:[{module, responsibleProfessionalUserId, dataLevels}]})` — staff cria `patient_company_links` status=`pending` + `creationPath='reactive'` + `invitedByUserId/invitedAt` + N modules status=`pending` em transação. Bloqueia se já existe link não-revogado pra mesmo passport+tenant.
    - `acceptPatientInvite({linkId, acceptedModules?, dataLevelOverrides?})` — em transação: valida link status=`pending` no tenant + carrega modules pendentes; **detecta colisões** com módulos ativos do mesmo passport em outros tenants (constraint global ADR 0077) → retorna CONFLICT com lista pra caller chamar `confirmModuleSubstitution()`; se sem colisão, atualiza link→`active`+`acceptedAt` + modules→`active`+`activatedAt` + aplica `dataLevelOverrides` se passados.
    - `cancelPatientInvite({linkId})` — staff cancela invite ainda em `pending` → status=`revoked` + `revokedReason='cancelled_by_staff'`.
    - `revokePatientLink({linkId, reason})` — staff revoga vínculo ativo → status=`revoked` + reason; em cascata desativa todos modules → status=`inactive` + `deactivatedReason='link_revoked'`.
    - `confirmModuleSubstitution({newLinkId, module})` — paciente confirma trocar empresa em módulo já ativo; em transação desativa módulo ativo global (qualquer tenant) → `status='inactive'` + `deactivatedReason='substituted_by_other_tenant'` + ativa novo módulo + eleva link pendente pra `active` se necessário.
    - `setSharingLevel({linkModuleId, dataLevels})` — staff ajusta data_levels do módulo (com consent prévio do paciente — Sprint 02b adiciona consent flow real).
    - `listInvites({status?, limit?})` — staff lista invites enviados pelo tenant (filtro por status pending/active/revoked/all) com JOIN persons.
    - `getCrossTenantSummary({passportPassportId, module, category, resourceType, resourceId?})` — chama `has_cross_tenant_access()` SQL + se TRUE resolve `sourceTenantId` via primeiro link ativo do passport fora deste tenant + insere `patient_data_access_log` (sempre — provê auditoria forense LGPD art. 11). Retorna `{allowed, sourceTenantId, reason}` (reason='hard_limit' pra categorias bloqueadas).
  - Landing invite `/i/[token]` em `apps/web/app/i/[token]/page.tsx` — Server Component público (sem auth) que resolve metadata via fetch a `GET /api/i/[token]`. Renderiza:
    - Header tenant emissor + profissional que enviou + data.
    - Card sobre empresa + lista módulos com ícone+label+descrição (🏋️ Academia / 🥇 Personal / 🩺 Fisioterapia / 🥗 Nutrição / 🧘 Pilates).
    - Card "Dados que serão compartilhados" agregando data_levels de todos modules (📇 Identidade / 📏 Antropometria / 💪 Treino / 🩺 Clínico apenas resumo).
    - Nota anti-fraude "notas privadas do profissional + financeiro + prontuário CFM original nunca cruzam empresas".
    - Status-driven CTA: `pending` → 2 botões (Fazer login + Criar conta apontando pra `/cadastro?invite=<token>` Sprint 02b); `already_accepted` → banner verde + link `/meu/privacidade`; `revoked`/`unknown` → banner vermelho.
  - API Route `GET /api/i/[token]` em `apps/web/app/api/i/[token]/route.ts` — endpoint público sem auth com regex UUID validation, retorna JSON com: token + status amigável (pending/already_accepted/revoked/unknown) + tenant name+slug + invitedByName (via JOIN users+persons) + invitedAt + acceptedAt + **personMaskedName** (anti-fraude: nome + iniciais do sobrenome) + modules com status + data_levels. **Não expõe dados sensíveis** do paciente — só metadata pra confirmação visual; aceite/recusa acontece após login.
  - Migration sem nova entry — função SQL via policy idempotente; tabelas já existiam Sprint 01b Faixa B.
  - **Typecheck verde 11/11 packages**. Tests SQL prontos pra rodar quando Postgres dev up (segue mesmo padrão exames-rls.test.ts/etc).
  - **Path B cadastro proativo + Turnstile + SMS Twilio adiados pra Sprint 02b**: precisam (a) Twilio sandbox provisionado + credentials cifradas; (b) Cloudflare Turnstile configurado em Sprint 00 (ainda pendente); (c) ADR sobre persons-without-tenant (schema atual exige tenantId NOT NULL — Sprint 02b decide se cria "system tenant" pivot ou refactor pra nullable + RLS adaptado). Sem essas dependências resolvidas, implementar /cadastro vira mock fake-it que não dá pra ligar em produção.

- **2026-05-12 — Faixas A+B+C entregues (Sprint 02 a 70%).** Núcleo CRM members aterrissado: 4 tabelas (`members`, `member_events` append-only, `member_notes` Nível 5, `member_tags` PK composta), 12 RLS policies isolamento per-tenant + append-only, ADR 0011 (member como perfil único cross-module), 10 Server Actions wrapped (createMember/updateMember/archiveMember/transferMember/addNote/addTag/removeTag/listTimeline/listNotes/listMembers/getMember) com `emitEvent()` fire-and-forget, UI completa `/app/members/*` (lista + new wizard + detail com slots Sprint 03+ + timeline). **7 Vitest tests novos** members-rls (isolamento, append-only, PK composta, soft-delete) — total 77 verdes. `addNote` marcado `// ai-blocked: regra 41+42` (Nível 5 nunca via IA). **30% restante adiado:** passaporte Server Actions completas (Sprint 11), portal paciente `/meu/*` (Sprint 26), cadastro proativo + Turnstile (fechamento Sprint 02), WhatsApp invite (Sprint 13), `has_cross_tenant_access()` (quando primeira leitura cross-tenant aterrissar), widget framework (Sprint 03+), `member_events` particionado (Sprint 04+ quando volume justificar).

## Definition of Done

- [ ] Feature flag `crm_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada nos 5 cenários
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 02 → `done`, item #4 → `done`
- [ ] Zero violação de regras

## Retro

- —
