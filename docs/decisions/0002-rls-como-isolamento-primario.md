# ADR 0002 — RLS do Postgres como isolamento primário entre tenants

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

LogiFit é multi-tenant. Vazamento de dado cross-tenant em sistema de saúde é incidente gravíssimo (LGPD + regulação profissional). Precisamos de uma estratégia de isolamento que seja robusta contra bug no código de aplicação (query esquecendo `WHERE tenant_id = ...`).

## Decision

- Toda tabela de negócio tem `tenant_id uuid not null`.
- Toda tabela tem RLS habilitado com policy mínima: `USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)`.
- `tenant_id` é injetado como **custom claim no JWT** via Supabase Auth Hook ao autenticar (e ao trocar de contexto, para usuários multi-tenant).
- CI tem teste que **falha** se encontrar tabela nova sem RLS habilitada.
- RLS é a **primeira** camada de defesa; RBAC com scope (company/unit) é camada adicional por cima.

## Consequences

- Mesmo que o código de aplicação esqueça um filtro `tenant_id`, o banco corta. Zero vazamento cross-tenant por bug trivial.
- Performance: RLS adiciona predicado em toda query. Aceitável com índices corretos em `tenant_id`.
- Debug mais complexo: query que "deveria funcionar" pode retornar vazio por policy. Mitigado por logging de `auth.uid()` e `auth.jwt()` em dev.
- Operações de manutenção (migrations, jobs) precisam rodar com service role, que bypassa RLS — exige disciplina.
- Usuário multi-tenant precisa de fluxo explícito de "trocar contexto" — JWT é reassinado com novo `tenant_id`.
