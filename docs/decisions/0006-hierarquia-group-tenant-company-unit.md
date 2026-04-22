# ADR 0006 — Hierarquia group → tenant → company → unit

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

O modelo inicial previa apenas `tenant` (cliente do SaaS) + `clinic` (unidade física). Durante a modelagem surgiram 3 necessidades adicionais:

1. Separar **pessoa jurídica** (CNPJ emissor de NF-e, conta Asaas, responsável fiscal) de **local físico** (endereço, catraca, estoque). Uma matriz pode ter várias unidades no mesmo CNPJ.
2. Suportar **matriz + filiais** com CNPJs distintos como parte da mesma rede/tenant.
3. Suportar **grupo organizacional do mesmo dono** que agrega múltiplos tenants (ex: dono tem 1 rede + 1 loja avulsa) sem ser uma entidade jurídica.

## Decision

Hierarquia de 4 níveis:

| Nível | É o quê | CNPJ? | RLS primária? | Dado sensível cruza? |
|---|---|---|---|---|
| `group` | Conjunto organizacional do mesmo dono | Não | **Não** (só agregados) | **Nunca** cruza tenants |
| `tenant` | Contrato SaaS (uma rede/empresa contratante) | Indireta | **Sim, raiz** | Isolado |
| `company` | Pessoa jurídica (matriz/filial) | Sim (1 por company) | Não (autorização) | Isolado quando franchise |
| `unit` | Local físico (endereço) | Não | Não (autorização) | Operacional |

- **Constraint:** exatamente 1 `company` com `type='matriz'` por tenant. Filial é opcional.
- **Loja avulsa = 1 tenant com 1 matriz + 1 unit.** Não cria nível extra.
- **CNPJ único global** — `companies.cnpj` é unique no sistema inteiro (não só por tenant).
- **Billing** acontece em `tenant`. Grupo não cobra.
- **Mobilidade cross-company** dentro do mesmo tenant é controlada por `tenant.cross_company_access`.

## Consequences

- Modelo cobre 4 cenários canônicos (rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede no mesmo group) com o mesmo schema.
- Crescimento orgânico (loja avulsa vira rede) é `INSERT`, não migração.
- Complexidade maior no onboarding — cliente precisa escolher topologia/flags ao criar tenant.
- RLS principal continua em `tenant_id`; `company_id` e `unit_id` filtram via RBAC/scope.
- Dashboard de grupo é **view agregada** — nunca `SELECT` direto cruzando tenants.
