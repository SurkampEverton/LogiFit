# Sprint 01b — RBAC com scope + Consent LGPD

- **Início:** planejado (depois do Sprint 01a)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #3

## Goal

Autorização com scope (group/tenant/company/unit), consent cross-module/cross-company, audit log particionado, todos testados nos 4 cenários canônicos.

## Critério de aceite

- Tabelas `roles`, `permissions`, `role_permissions`, `user_roles` (com `scope_type` + `scope_id`) criadas
- Roles base: `super_admin_rede`, `diretor_matriz`, `gerente_filial`, `recepcao`, `fisio`, `nutri`, `instrutor`, `aluno`, `group_owner`
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

## Dependências

- Sprint 01a (identidade + hierarquia + RLS raiz)

## Decisões tomadas / ADRs esperados

- [ADR 0005 — RBAC com consent cross-module](../decisions/0005-rbac-com-consent-cross-module.md)
- [ADR 0008 — Group como camada agregada](../decisions/0008-group-como-camada-agregada.md)
- **ADR 0019 (esperado)** — Autorização por role + role custom por tenant + grant direto `user_permissions`. Policies RLS fazem union de `user_roles` e `user_permissions` ativos (`revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`). Grants sempre têm `expires_at` sugerido (UX força preencher; "sem expiração" exige justificativa).

## Commit

- [ ] Schema Drizzle: `roles`, `permissions`, `role_permissions`, `user_roles` com scope
- [ ] Schema Drizzle: `user_permissions` — `id`, `tenant_id`, `user_id`, `permission text`, `scope_type`, `scope_id`, `granted_by user_id`, `granted_at`, `expires_at nullable`, `revoked_at nullable`, `reason text`. Índices: `(tenant_id, user_id, permission)`; parcial `WHERE revoked_at IS NULL`.
- [ ] Seed das roles base + permissions padrão
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
- [ ] Página `/app/perfil/privacidade` para aluno ver/revogar consents
- [ ] Testes E2E contra os 4 cenários canônicos
- [ ] Testes E2E específicos de grants: criar, usar, revogar, expirar
- [ ] ADR 0019 publicado

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
