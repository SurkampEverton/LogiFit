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
- RLS multi-nível funcionando: tenant + company/unit conforme scope do user
- Tabela `consents` + fluxo de opt-in de consentimento cross-module
- Tabela `franchise_agreements` para `topology=franchise` com `cross_company_access=true`
- `audit_log` append-only, particionado por mês
- Views agregadas `group_metrics` (somente números, nunca dado individual)
- Teste E2E: `fisio` não vê prontuário de `company` onde não tem scope
- Teste E2E: `group_owner` vê dashboard agregado mas **não** lista de membros individual
- Teste E2E: dado clínico não cruza `company_id` em `topology=franchise`

## Dependências

- Sprint 01a (identidade + hierarquia + RLS raiz)

## Decisões tomadas

- [ADR 0005 — RBAC com consent cross-module](../decisions/0005-rbac-com-consent-cross-module.md)
- [ADR 0008 — Group como camada agregada](../decisions/0008-group-como-camada-agregada.md)

## Commit

- [ ] Schema Drizzle: `roles`, `permissions`, `role_permissions`, `user_roles` com scope
- [ ] Seed das roles base + permissions padrão
- [ ] Policies RLS multi-nível (tenant + company + unit)
- [ ] Schema `consents` + UI de opt-in (onboarding do aluno)
- [ ] Schema `franchise_agreements` + UI básica de configuração
- [ ] Schema `audit_log` append-only + partições mensais via pg_partman ou trigger
- [ ] Views `group_metrics`, `group_revenue_30d` com policies próprias
- [ ] Página `/settings/roles` para admin atribuir roles/scopes
- [ ] Página `/perfil/privacidade` para aluno ver/revogar consents
- [ ] Testes E2E contra os 4 cenários canônicos

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
