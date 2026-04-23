# Sprint 01b — RBAC com scope + Consent LGPD + Registros profissionais em conselho

- **Início:** planejado (depois do Sprint 01a)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #3

## Goal

Autorização com scope (group/tenant/company/unit), consent cross-module/cross-company, audit log particionado, **registros profissionais em conselho (CRM/CRN/CREFITO/CREF)** para habilitar assinatura regulatória e faturamento TISS nas fases seguintes — todos testados nos 4 cenários canônicos.

## Critério de aceite

- Tabelas `roles`, `permissions`, `role_permissions`, `user_roles` (com `scope_type` + `scope_id`) criadas
- Roles base: `super_admin_rede`, `diretor_matriz`, `gerente_filial`, `recepcao`, `fisio`, `nutri`, `instrutor`, `aluno`, `group_owner`, **`contador_externo`** (ADR 0061 — read-only fiscal/financeiro/NF-e em todas as companies do tenant; MFA obrigatório; portal dedicado `/app/contador`; nunca vê prontuário/consulta/avaliação)
- `role_permissions` editável por tenant (permite **role custom**; ex: `contador_externo`, `recepcao_com_financeiro`)
- Tabela `user_permissions` para **grants diretos** user → permission, com `scope`, `expires_at`, `reason`, `granted_by` (exceções pontuais que não viram role)
- RLS multi-nível funcionando: tenant + company/unit conforme scope, com **union** entre `user_roles` e `user_permissions` (ambos concedem acesso)
- Tabela `consents` + fluxo de opt-in de consentimento cross-module
- Tabela `franchise_agreements` para `topology=franchise` com `cross_company_access=true`
- `audit_log` append-only, particionado por mês; toda criação/revogação de grant grava aqui
- Views agregadas `group_metrics` (somente números, nunca dado individual)
- Teste E2E: `fisio` não vê prontuário de `company` onde não tem scope
- Teste E2E: `group_owner` vê dashboard agregado mas **não** lista de membros individual
- **Teste E2E explícito da regra 25**: criar cenário franquia (tenant.topology='franchise') com 2 companies + member A em company 1 + member B em company 2; tentar (a) SELECT direto cross-company (deve retornar 0 rows via RLS), (b) criar consent.share_injury_to_training entre os dois (deve bloquear ou retornar erro explícito), (c) função `has_permission` cross-company em franchise (deve retornar false). CI falha se qualquer desses passarem
- Teste E2E: recepção (sem `financeiro.read` na role) ganha grant direto `financeiro.read` scope `company:X` com `expires_at` futuro → passa a ver `/app/financeiro/*` e widget financeiro no dashboard do member
- Teste E2E: grant com `expires_at` no passado é ignorado pela policy (job noturno marca `revoked_at`)
- Tabela `professional_registrations` criada (ADR 0055) com `person_id` FK, `council_body` (CRM/CRN/CREFITO/CREF + enum aberto para CRF/CRP/COREN/CRO futuros), `council_number`, `council_state`, `cbo_code nullable`, `situation` (`active`/`suspended`/`cassated`/`expired`/`pending_verification`/`unknown`), `verified_at`, `verification_source` (`operator_attested` default no MVP)
- Constraint global unique `(council_body, council_number, council_state)` — mesmo número de conselho não existe em 2 tenants (detecta fraude)
- Uma pessoa pode ter **N registros** — profissional dual (fisio + PT; médico em 2 UFs)
- UI `/app/pessoas/[id]/registros` — admin/gerente cadastra, atualiza situação, anexa documento (opcional)
- Teste E2E: criar pessoa fisio → cadastrar CREFITO-3 12345 → `situation='pending_verification'`; admin confirma → `active`; simular `suspended` → bloqueia gate downstream do Sprint 20/22/23 (testes específicos nos sprints)
- Teste E2E: tentar cadastrar o mesmo CRM/SP/99999 em 2 tenants diferentes → constraint global rejeita

## Dependências

- Sprint 01a (identidade + hierarquia + RLS raiz)

## Decisões tomadas / ADRs esperados

- [ADR 0005 — RBAC com consent cross-module](../decisions/0005-rbac-com-consent-cross-module.md)
- [ADR 0008 — Group como camada agregada](../decisions/0008-group-como-camada-agregada.md)
- [ADR 0055 — Registros profissionais em conselho](../decisions/0055-registros-profissionais-em-conselho.md)
- **ADR 0019 (esperado)** — Autorização por role + role custom por tenant + grant direto `user_permissions`. Policies RLS fazem union de `user_roles` e `user_permissions` ativos (`revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`). Grants sempre têm `expires_at` sugerido (UX força preencher; "sem expiração" exige justificativa).

## Commit

- [ ] Schema Drizzle: `roles`, `permissions`, `role_permissions`, `user_roles` com scope
- [ ] Schema Drizzle: `user_permissions` — `id`, `tenant_id`, `user_id`, `permission text`, `scope_type`, `scope_id`, `granted_by user_id`, `granted_at`, `expires_at nullable`, `revoked_at nullable`, `reason text`. Índices: `(tenant_id, user_id, permission)`; parcial `WHERE revoked_at IS NULL`.
- [ ] Seed das roles base + permissions padrão; **role `contador_externo`** com `fiscal.read`, `financeiro.read`, `nfe.read`, `retencoes.read` em scope `tenant` (todas companies); **sem** permissions de gravação; **sem** acesso a `prontuario.read`, `avaliacao.read`, `member.read_sensitive`, `consulta.read` (ADR 0061 + LGPD art. 11)
- [ ] Fluxo de convite para contador externo: admin em `/app/settings/contador/convidar` → envia magic link via Resend → contador aceita, cria senha, ativa MFA obrigatório → acesso read-only liberado (reusa infra Sprint 01a magic link)
- [ ] Teste E2E: contador externo convidado loga via magic link, ativa TOTP, vê `/app/contador` + `/app/financeiro/*` (leitura), **não** vê `/app/members/*` (bloqueado por RLS) nem consegue gravar em AP/AR
- [ ] `role_permissions` permite escrita por tenant (admin edita) — role custom por tenant via UI
- [ ] Policies RLS multi-nível (tenant + company + unit) com **union** de `user_roles` + `user_permissions` ativos (função SQL `has_permission(user_id, permission, scope_type, scope_id)` centraliza)
- [ ] Schema `consents` + fluxo de opt-in (onboarding do aluno)
- [ ] Schema `franchise_agreements` + UI básica
- [ ] Schema `audit_log` append-only + partições mensais; eventos: `grant.created`, `grant.revoked`, `role.created`, `role.updated`
- [ ] Views `group_metrics`, `group_revenue_30d` com policies próprias
- [ ] Página `/app/settings/roles` — lista + criar/editar role custom do tenant; atribuir role+scope a user
- [ ] Página `/app/settings/users/[id]/grants` — lista de grants diretos do user (ativos e histórico) + modal "Novo grant" com: `permission` (select), `scope` (tenant/company/unit + id), `expires_at` (obrigatório por default; "sem expiração" exige abrir dropdown de justificativa), `reason text required`
- [ ] Ação `revokeGrant(grantId)` em Server Action — seta `revoked_at = now()`; RLS passa a ignorar
- [ ] Job noturno (cron) marca grants vencidos (`expires_at < now() AND revoked_at IS NULL`) como `revoked_at = expires_at`
- [ ] Página `/app/perfil/privacidade` (operador logado vê próprios consents + MFA)
- [ ] **Portal do titular `/meu/privacidade` (scaffold)** (ADR 0054) — member/paciente acessa via magic link do Sprint 26 (portal web). MVP aqui lista os 8 direitos LGPD art. 18 (I confirmação do tratamento, II acesso, III correção, IV anonimização/bloqueio/eliminação, V portabilidade, VI informação sobre compartilhamento, VII informação sobre consequência de não consentir, VIII revogação de consent) como botões "Solicitar"; cada clique cria `data_subject_requests` (draft → in_review → fulfilled → expired) com SLA 15 dias; **apagamento é solicitação, não automático** (contador+profissional precisam validar obrigações de retenção como prontuário 20 anos, CFM 2.299/2021). UI completa (formulários de solicitação, histórico, timeline SLA) entra no Sprint 26.
- [ ] Schema `data_subject_requests` (ADR 0054) — `id`, `tenant_id`, `member_id`/`person_id`, `right` enum (`confirmation`/`access`/`rectification`/`anonymization`/`portability`/`sharing_info`/`consent_info`/`revocation`), `status` enum (`draft`/`in_review`/`fulfilled`/`rejected`/`expired`), `request_justification text`, `fulfilled_payload jsonb nullable`, `rejected_reason text nullable`, `deadline_at timestamptz not null` (created_at + 15 dias), `created_at`, timestamps. Trigger de criação calcula `deadline_at`; job diário alerta requests em D-3 do deadline.
- [ ] **Página `/app/settings/compliance/comite-ia`** (ADR 0053) — admin cadastra membros do Comitê de IA (mínimo 1 ativo); form: `user_id` + `role_in_committee` (presidente/membro/secretário) + `started_at` + `ended_at nullable`; upload obrigatório de **ata de criação** do comitê; calendário de **revisões periódicas** (semestrais por default); alerta se revisão overdue; gate visual: "Comitê de IA: ✓ ativo" ou "⚠ sem membro ativo — features IA classe II+ desabilitadas automaticamente".
- [ ] **Página `/app/compliance/ia`** (ADR 0053) — dashboard de conformidade IA: tabela de features IA ativas (nome, classe SaMD I/II/III/IV, ADR de referência, última revisão do comitê, status gate) + link para `docs/compliance/samd-classification.md` (doc do repo) + log de decisões humanas em `ai_audit_log` do tenant (paginado por data/feature/usuário/decisão aceitou/editou/rejeitou); visível para roles `super_admin_rede` + `diretor_matriz`.
- [ ] Schema `ai_committee_members` (ADR 0053) — `id`, `tenant_id`, `user_id fk`, `role_in_committee` enum, `started_at`, `ended_at nullable`, `ata_storage_path text nullable`, `notes text`. Unique parcial `(tenant_id, user_id) WHERE ended_at IS NULL` (um user ativo no comitê por vez).
- [ ] Schema `ai_committee_reviews` (ADR 0053) — `id`, `tenant_id`, `period_start date`, `period_end date`, `conducted_at timestamptz`, `minutes_storage_path text`, `signed_by_committee_members uuid[]`, `notes text`. Trigger alerta 30d antes de nova revisão semestral.
- [ ] Schema `ai_feature_classifications` (ADR 0053) — `id`, `tenant_id`, `feature_key text` (ex: `copilot`, `previsao_churn`, `pipeline_exames`), `samd_class` enum (`I`/`II`/`III`/`IV`), `requires_anvisa_notification bool`, `requires_committee bool` (true se class >= II), `sprint_ref text`, `active bool`. Tenant_id NULL = global curado LogiFit (tabela viva `docs/compliance/samd-classification.md`).
- [ ] **Gate de feature flag para IA classe II+:** wrapper `withAiClassGate(featureKey, fn)` em `packages/ai/gate.ts` — consulta `ai_feature_classifications` + `ai_committee_members`; se classe II+ e comitê sem membro ativo → bloqueia execução + grava audit.
- [ ] Teste E2E: admin cadastra membro do comitê + anexa ata → feature IA classe II (ex: Copilot) fica ativa; admin remove todos os membros → feature bloqueada automaticamente
- [ ] Teste E2E: aluno solicita "acesso aos meus dados" em `/meu/privacidade` → cria `data_subject_requests` com deadline 15d → admin recebe alerta → admin cumpre → status `fulfilled`
- [ ] Schema Drizzle: `professional_registrations` — `id`, `tenant_id`, `person_id` fk (kind=pf via trigger), `council_body` enum, `council_number text`, `council_state text`, `specialty text nullable`, `cbo_code text nullable`, `situation` enum, `issued_at date nullable`, `verified_at timestamptz nullable`, `verified_by_user_id nullable`, `verification_source` enum (default `operator_attested`), `valid_until date nullable`, `document_storage_path nullable`, `archived_at timestamptz nullable`, timestamps
- [ ] Constraint global unique `(council_body, council_number, council_state)` — cross-tenant
- [ ] Seed: permissions `profissional.read`, `profissional.write` + atribuições padrão (`super_admin_rede`, `diretor_matriz`, `gerente_filial` ganham write)
- [ ] View `v_professional_registrations_active` filtra `archived_at IS NULL AND situation IN ('active','pending_verification')`
- [ ] UI `/app/pessoas/[id]/registros` — lista + add/edit + mudança de situação com audit
- [ ] Upload opcional de documento (carteirinha/comprovante) para Storage bucket `professional-docs` privado com URL assinada curta
- [ ] Seed dos 4 conselhos base no enum: CRM, CRN, CREFITO, CREF; preparar (no enum mas sem seed de dados): CRF, CRP, COREN, CRO
- [ ] Testes E2E contra os 4 cenários canônicos
- [ ] Testes E2E específicos de grants: criar, usar, revogar, expirar
- [ ] Teste E2E de registro profissional: cadastro + atestação + mudança de situação + unicidade global
- [ ] ADR 0019 publicado
- [ ] ADR 0055 publicado

## Stretch

- [ ] UI de visualização de audit log (`/admin/audit`) para role `audit_viewer`

## Log

- —

## Definition of Done

- [ ] Feature flag `rbac_v1` criada
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada nos 4 cenários com roles diferentes
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG.md atualizado
- [ ] Roadmap atualizado (item #3 → done)
- [ ] Zero violação de regras

## Retro

- —
