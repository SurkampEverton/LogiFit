# Sprint 14 — Geral · DRE + Custos operacionais

- **Área:** geral
- **Início:** planejado (depois do Sprint 13)
- **Fim planejado:** +2 semanas
- **Status:** planejado
- **Item do roadmap:** #16

## Goal

Registro de custos fixos e variáveis por company + DRE consolidado por período + previsibilidade de receita baseada em contratos ativos. Fecha a visão financeira do gestor (receita × despesa × projeção).

## Critério de aceite

- Catálogo `cost_categories` por tenant (aluguel, folha, marketing, manutenção, energia, água, etc) com tipo `fixed` ou `variable`
- Registro `cost_entries` mensal ou pontual, com anexo opcional (nota fiscal PDF)
- Recorrência de custo (ex: aluguel todo dia 5) — gera `cost_entries` automaticamente
- DRE por período: receita (já existe — vem do Sprint 04) - custos + saldo
- DRE por company e consolidado por tenant (quando `financial_mode=distributed`)
- **Lucratividade por procedimento/serviço**: DRE com dimensão adicional `service_type` (ex: consulta fisio, aula pilates, personal, consulta nutri) — exige que `invoice_items` (estender no Sprint 04) guardem `service_type` ou link com `appointment/consulta`
- **Previsibilidade de receita**: projeção 3 meses com base em contratos ativos + histórico de churn + cobranças pendentes
- Comparativo mês × mês, ano × ano
- Exportar DRE em PDF e CSV
- Teste E2E: criar categoria, registrar 5 custos, gerar DRE, confirmar cálculo
- Seed: 6 categorias + 10 custos últimos 3 meses por tenant

## Dependências

- Sprint 04 (receita/invoices)
- Sprint 01b (audit — registro de custo = ação administrativa audited)

## Decisões tomadas / ADRs esperados

- **ADR (não precisa novo)** — categorias com `type` (fixed/variable) é estrutura trivial; não justifica ADR.
- **Pergunta aberta:** modelo de previsibilidade — heurística simples (contratos ativos × valor - taxa de churn histórica) vs modelo mais sofisticado. Começar simples; sofisticação pode virar evolução do Sprint 19 (churn preditivo).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Catálogo de categorias de custo
- Registro de custos (pontuais + recorrentes)
- DRE por período / company / tenant
- Previsibilidade de receita

## Rotas Next.js

- `/app/financeiro/custos` — lista + filtros
- `/app/financeiro/custos/categorias` — catálogo
- `/app/financeiro/custos/new` — cadastro
- `/app/financeiro/custos/recorrentes` — CRUD de recorrências
- `/app/financeiro/dre` — DRE interativa (seletor período + company)
- `/app/financeiro/previsao` — projeção 3 meses + análise de sensibilidade (simulador: "se perder X% de alunos...")

## Server Actions + API Routes

Server Actions em `apps/web/app/financeiro/custos/actions.ts`:

- `createCostCategory` / `updateCostCategory` / `archiveCostCategory`
- `createCostEntry(categoryId, companyId, amountCents, incurredAt, description, attachment?)` — anexo vai para Storage
- `createRecurringCost(categoryId, companyId, amountCents, dayOfMonth, startsAt, endsAt?)`
- `generateDre(from, to, companyId?)` — retorna estrutura `{ revenue, costs_by_category, gross_margin, net }`
- `forecastRevenue(monthsAhead)` — retorna projeção + intervalo de confiança

API Routes:

- Job: `POST /api/jobs/custos/recurring-tick` (diário) — gera `cost_entries` das recorrências que batem no dia

## Schemas Drizzle (esperado)

Em `packages/db/schema/custos.ts`:

- `cost_categories` — `id`, `tenant_id`, `name`, `type` enum (`fixed`, `variable`), `icon text`, `archived_at`
- `cost_entries` — `id`, `tenant_id`, `company_id`, `category_id`, `amount_cents`, `incurred_at date`, `description text`, `attachment_storage_path nullable`, `recurring_cost_id nullable`, `created_by_user_id`, `created_at`
- `recurring_costs` — `id`, `tenant_id`, `company_id`, `category_id`, `amount_cents`, `day_of_month int` (1–28), `starts_at date`, `ends_at date nullable`, `last_generated_at date nullable`, `active bool`

**RLS:** tenant_id + scope. Gerente de company só vê custos da própria company. Diretor vê todas.

## Eventos de domínio emitidos

- `cost.recorded` — `{ entry_id, category, company_id, amount_cents, at }`
- `cost.recurring_created` / `cost.recurring_paused`
- `dre.generated` (audit) — `{ period, company_id?, by_user, at }` — DRE é dado sensível administrativo

## Commit (checklist)

- [ ] Schema Drizzle: `cost_categories`, `cost_entries`, `recurring_costs`
- [ ] RLS + audit em leituras de DRE
- [ ] Zod schemas
- [ ] Server Actions + job de recorrência
- [ ] Calculadora de DRE em `packages/db/financeiro/dre.ts`
- [ ] Heurística de previsibilidade em `packages/ai/financeiro/forecast.ts` (usa taxa histórica de churn simples — Sprint 19 pode substituir depois)
- [ ] UI custos com filtros + upload de NF-e PDF
- [ ] UI DRE com gráficos de barras (categoria) e linha (evolução temporal)
- [ ] **Dimensão "lucratividade por procedimento"** na UI: selector que pivota DRE por `service_type`; exige que Sprint 04 tenha enriquecido `invoice_items` com `service_type`/`tuss_code` (migração retroativa via backfill)
- [ ] UI previsibilidade com simulador interativo
- [ ] Export PDF (usa biblioteca, ex: `@react-pdf/renderer`) e CSV
- [ ] Permission `custos.read`, `custos.write`, `dre.read`
- [ ] Card "Custos do mês" no dashboard do gerente (Sprint 07)
- [ ] Seed: 6 categorias + 10 custos + 3 recorrências
- [ ] Testes unit da calculadora DRE (casos: 1 company, N companies, com/sem custos variáveis)
- [ ] Testes E2E: registro → DRE → exportação
- [ ] Feature flag `custos_v1`

## Stretch

- [ ] Importação de extrato bancário (OFX/CSV)
- [ ] Conciliação bancária
- [ ] Centros de custo (granularidade além de category: ex: custo por unit)
- [ ] Benchmark com outras companies do mesmo porte (agregado anonimizado, respeitando regra 26)

## Log

- —

## Definition of Done

- [ ] Feature flag `custos_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 14 → `done`

## Retro

- —
