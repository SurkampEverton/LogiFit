# ADR 0047 — Cadastro central de `persons` com FK em tabelas especializadas

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O planejamento original do LogiFit tinha 5 cadastros separados: `members` (clientes), `leads` (prospects), `suppliers` (fornecedores), `companies` (PJ da hierarquia) e `users` (equipe operacional). Cada um duplicava campos de identidade (nome, CPF/CNPJ, email, phone, endereço).

Problemas concretos:

1. **Duplicação** — pessoa que é cliente e fornecedor vira 2 cadastros; mudou telefone, muda 2× ou desincroniza.
2. **Conversão forçada a recriar** — lead que vira aluno cria novo `members` em vez de reusar o cadastro existente (viola regra 24 que proíbe deletar/recriar).
3. **Impossível dedupe** — sistema não tem como detectar que "Maria da academia" é a mesma "Maria da clínica fisio" do mesmo tenant.
4. **UX ruim** — cadastrar aluna que também é fornecedora do tenant faz operador digitar tudo 2 vezes.

O usuário pediu explicitamente: "cadastro centralizado, que eu possa referenciar em outros lugares como cadastro de unidades, usuários etc apenas completando os dados específicos de cada tela".

Opções avaliadas:

- **(A) Party Model completo** — tabela central `parties` + tabela intermediária `party_roles` + tabelas `*_data` especializadas. Padrão de ERPs grandes (SAP/Odoo). **Rejeitado:** complexidade alta para dev solo; `party_roles` exige JOIN em toda query; casos de papel múltiplo são minoria.
- **(B) Contact-FK (this ADR)** — tabela central `persons` + tabelas especializadas mantêm estrutura atual mas substituem campos de contato por FK `person_id`. Sem tabela intermediária.
- **(C) Status quo** — tabelas separadas com campos duplicados. **Rejeitado:** perde oportunidade barata de dedupe e UX coerente.

## Decision

Adotar **modelo Contact-FK (opção B):**

- **`persons`** como tabela central de cadastro de pessoa (física ou jurídica) por tenant
  - Detecção automática PF/PJ pelo tamanho do documento digitado (11 dígitos = CPF/PF; 14 = CNPJ/PJ) com validação matemática do dígito verificador
  - Campos: `kind` (pf/pj), `name`, `display_name`, `document` (CPF ou CNPJ), `birth_date`, `sex` (só PF), `email`, `phone`, `address jsonb`, `notes`, `archived_at`
  - Unicidade: `(tenant_id, document)` — CPF/CNPJ é único dentro do tenant; mesmo CPF pode existir em tenants diferentes (regra 22 continua valendo para CNPJ de companies via constraint específica)

- **Tabelas especializadas** (`members`, `leads`, `suppliers`, `companies`, `users`, `professional_contracts`) ganham `person_id` como FK obrigatório
  - Perdem campos duplicados de contato (nome, documento, email, phone, endereço — agora vêm de `persons`)
  - Mantêm seus campos específicos (ex: `members.home_unit_id`, `suppliers.default_payment_term_days`, `companies.type`, `users.auth_user_id`)

- **`units`** permanece como tabela separada (não é pessoa — é local físico; tem `company_id` FK, endereço próprio)

- **Fluxo de UI:** cadastra-se a pessoa uma vez em `/app/pessoas/new` (genérico). Nas telas especializadas (`/app/settings/users/new`, `/app/members/new`, `/app/financeiro/fornecedores/new`, etc.), busca-se a pessoa existente (por nome/CPF/CNPJ/email) ou cria nova, e só completa os campos específicos daquela tela.

- **Múltiplos papéis acontecem naturalmente:** a mesma `person_id` pode estar referenciada em `members`, `suppliers` e `users` simultaneamente — sem tabela intermediária de papéis.

- **Views de leitura** `v_person_roles(person_id, tenant_id, roles text[])` lista os papéis ativos por pessoa (útil para UI "esta pessoa é: aluna, fornecedora"). Opcional; cada tabela especializada também pode ser consultada diretamente.

- **Constraints importantes:**
  - `users.person_id` exige `persons.kind = 'pf'` (login é sempre pessoa física)
  - `companies.person_id` exige `persons.kind = 'pj'` (empresa é sempre PJ)
  - `members` e `leads` podem ser PF ou PJ (cliente corporativo é raro mas suportado)
  - `suppliers` pode ser PF ou PJ (autônomo ou empresa)
  - `(person_id, tenant_id)` em cada especializada é unique — mesma pessoa não vira 2 members no mesmo tenant (transferência entre companies muda `company_id`, não duplica; regra 24 preservada)

## Consequences

### Positivas

- **Dedupe natural:** mesma pessoa em múltiplos papéis é 1 `persons` + N registros especializados linkados.
- **Mudança de contato propaga:** update em `persons.phone` reflete em todos os papéis sem sincronização manual.
- **Conversão lead → member limpa:** adiciona registro em `members` com mesmo `person_id` (não deleta/recria — regra 24 preservada).
- **Busca unificada:** UI de autocomplete em qualquer tela ("novo usuário") pode buscar toda a base de pessoas do tenant e mostrar papéis já existentes.
- **Base única de LGPD:** export de dados pessoais do tenant via consulta em `persons`; consent continua em tabelas específicas.
- **Preparação para cliente corporativo:** tenant pode vender plano para empresa (kind=pj como member) sem refactor adicional.

### Negativas (mitigáveis)

- **1 JOIN extra em queries de leitura** — mitigado por views materializadas (`v_members_full`, `v_suppliers_full`) para leituras quentes.
- **Fixture de teste cria `persons` antes** — mitigado por factory helper `createPerson({...overrides})` ou `createMemberWithPerson(...)` em `packages/db/test-helpers`.
- **Refactor de 5 sprints já documentados** — escopo controlado; custo é de documentação, não de código (zero código escrito ainda).
- **Migration futura se algum campo de persons virar específico** — aceitável; modelo é evolutivo.

### Invariantes e regras preservadas

- **Regra 1 (tenant_id + RLS em toda tabela):** `persons` também tem `tenant_id` + RLS.
- **Regra 22 (CNPJ unique global entre companies):** mantida via constraint em `companies` linkando `persons.document` onde kind=pj; não impede que a mesma `persons` (CNPJ) apareça em outros tenants como fornecedor.
- **Regra 24 (transferência não deleta/recria):** reforçada — conversão de papel adiciona linha nova, nunca mexe na persons existente.
- **Regra 25 (dado clínico não cruza company em franchise):** mantida — `persons` não carrega dado clínico; este vive em `consultas`/`evolucoes_sessao` com `company_id` próprio.

## Escopo de impacto nas docs

Sprints afetados (só documentação — zero código escrito):

- **Sprint 01a** — cria `persons` junto com `groups/tenants/companies/units/users`. Companies e users ganham `person_id` FK.
- **Sprint 02** — `members.person_id` FK. Remove campos duplicados.
- **Sprint 10** — `leads.person_id` FK (nullable até lead ter identificação mínima).
- **Sprint 15** — `suppliers.person_id` FK.
- **Sprint 23** — `professional_contracts` referencia `person_id` direto (quando profissional não é user do sistema — ex: terceirizado).
- **`docs/modulos.md`** — adiciona módulo "Cadastro central de pessoas (persons)" na Fundação.
- **`docs/arquitetura.md`** — tabelas mestras incluem `persons`.
- **`CHANGELOG.md`** — entrada do refactor.

## Alternativas rejeitadas (resumo)

| Alternativa | Motivo da rejeição |
|---|---|
| Party Model completo (`parties + party_roles + *_data`) | Complexidade alta para dev solo; JOIN em party_roles para toda query simples; benefício marginal sobre Contact-FK |
| Status quo com tabelas separadas duplicando campos | Perde dedupe; conversão lead→member dolorosa; UX ruim |
| Parties só para PF, companies separadas | Híbrido que mistura dois modelos; complexidade sem simplificação proporcional |

## Related

- Substitui parcialmente o modelo de cadastro descrito em [ADR 0006 — Hierarquia group → tenant → company → unit](0006-hierarquia-group-tenant-company-unit.md) (mantém hierarquia, muda como `company` armazena dados de identidade).
- Reforça [regra 24](../rules.md) — transferência de member entre companies.
- Complementa [regra 22](../rules.md) — CNPJ unique global em companies via constraint derivada.
