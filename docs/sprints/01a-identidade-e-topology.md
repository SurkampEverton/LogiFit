# Sprint 01a — Identidade e Topology

- **Início:** planejado (depois do Sprint 00)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #2

## Goal

Autenticação + hierarquia completa (group/tenant/company/unit) + RLS raiz + seed dos 4 cenários canônicos, tudo funcionando ponta-a-ponta.

## Critério de aceite

- Login via magic link + OAuth Google funciona
- MFA (TOTP) obrigatório para roles profissionais, opcional para aluno
- JWT contém custom claims: `tenant_id`, `group_ids[]` (se aplicável), `topology`
- Hierarquia criada: `groups`, `tenants` (com 3 flags), `companies` (matriz/filial), `units`
- Constraint no banco: exatamente 1 matriz por tenant
- CNPJ unique global
- RLS raiz em todas as tabelas: `tenant_id = auth.jwt() ->> 'tenant_id'`
- Teste E2E: usuário do tenant A não vê dados do tenant B (nem via API, nem via Supabase client direto)
- Seed dos 4 cenários canônicos populado em dev
- Troca de contexto de tenant (para usuário multi-tenant) reassina JWT

## Dependências

- Sprint 00 (infra pronta)

## Decisões tomadas

- [ADR 0002 — RLS como isolamento primário](../decisions/0002-rls-como-isolamento-primario.md)
- [ADR 0006 — Hierarquia group → tenant → company → unit](../decisions/0006-hierarquia-group-tenant-company-unit.md)
- [ADR 0007 — Topology owned vs franchise](../decisions/0007-topology-owned-vs-franchise.md)
- [ADR 0008 — Group como camada agregada](../decisions/0008-group-como-camada-agregada.md)
- [ADR 0009 — Loja avulsa não vira nível próprio](../decisions/0009-loja-avulsa-nao-vira-nivel-proprio.md)

## Commit

- [ ] Supabase Auth + magic link + OAuth Google
- [ ] MFA obrigatório para roles profissionais (TOTP)
- [ ] Supabase Auth Hook injetando `tenant_id` + `group_ids` no JWT
- [ ] Schema Drizzle: `groups`, `tenants` (flags), `companies` (type + cnpj unique), `units`
- [ ] Constraint 1-matriz-por-tenant (trigger ou exclude constraint)
- [ ] Tabela `user_tenants` (N:N) + fluxo de seleção de contexto ao logar
- [ ] RLS raiz em todas as tabelas criadas
- [ ] Script de seed com os 4 cenários canônicos
- [ ] Teste E2E Playwright: isolamento entre tenants
- [ ] Teste CI: script que falha se tabela nova não tem RLS
- [ ] Página `/login`, `/signup`, `/select-tenant`, `/settings/mfa`
- [ ] Logout global + revogação por dispositivo

## Stretch

- [ ] Impersonation para suporte LogiFit (com audit log reforçado)

## Log

- —

## Definition of Done

- [ ] Feature flag `auth_v1` criada
- [ ] Testes unit + E2E verdes (incluindo os 4 cenários de seed)
- [ ] RLS verificada nos 4 cenários
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG.md atualizado
- [ ] Roadmap atualizado (item #2 → done)
- [ ] Zero violação de regras

## Retro

- —
