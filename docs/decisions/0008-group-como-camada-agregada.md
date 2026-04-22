# ADR 0008 — `group` é camada apenas agregada, não entra em RLS de isolamento

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Introduzimos `group` para representar um dono/holding que possui múltiplos tenants (ex: uma rede + uma loja avulsa sob o mesmo dono). Havia duas opções:

- **A)** Usar `group` como camada de RLS — queries cruzam tenants do mesmo group naturalmente.
- **B)** Usar `group` apenas como metadado agregado — isolamento continua em `tenant_id`, e queries cross-tenant só existem via views agregadas dedicadas.

Opção A é simples mas perigosa: qualquer bug vaza dado pessoal entre tenants (que são empresas juridicamente distintas, com políticas de privacidade separadas).

## Decision

Adotar opção B:

- `groups` é **apenas metadado organizacional e agregado.** Não aparece em nenhuma policy RLS de tabela operacional (members, appointments, invoices, prontuarios, etc).
- Dono do grupo vê dashboards via **views dedicadas** (`group_metrics`, `group_revenue_30d`, etc) que produzem apenas **somas, médias, contagens** — nunca CPF, nunca prontuário, nunca dado individual.
- Views têm suas próprias policies RLS verificando se o usuário é `group_owner` daquele grupo.
- Para operar dentro de um tenant específico, dono precisa ter role adicional explícito naquele tenant (ex: `diretor_rede` em `tenant:X`). Entrar em um tenant **reassina o JWT** com `tenant_id` do contexto escolhido.
- Teste de CI falha se encontrar `SELECT` cross-tenant usando `group_id` em tabela operacional.

## Consequences

- Isolamento entre tenants do mesmo grupo é **tão forte** quanto entre tenants não relacionados. Mesmo bug crítico no dashboard de grupo só vaza agregados.
- Dashboard de grupo é menos "rico" — não mostra dados individuais, só KPIs. Aceitável e desejável do ponto de vista regulatório.
- Dono precisa explicitamente "entrar" em um tenant para operar — adiciona 1 clique, mas deixa registro em audit_log de quando operou em cada tenant.
- Se no futuro quisermos um verdadeiro "super-admin cross-tenant", será outra mecânica (impersonation explícita com consentimento bilateral e audit intenso), nunca scope automático.
