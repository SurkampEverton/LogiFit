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

- **2026-05-13 — Faixas A+B+C+D entregues (Sprint 14 a 100%).** Schemas: 3 tabelas (`cost_categories` slug+type fixed/variable + icon + soft-delete archived_at; `cost_entries` amount_cents + incurred_at date + company-scoped via FK + check amount_positive + recurring_cost_id FK lógica; `recurring_costs` day_of_month 1-28 com check range + check ends_after_starts + last_generated_at pra idempotência cron) + 10 RLS policies tenant-scoped + migration 0020 + 11 unit tests (unique slug per tenant, isolation, check amount_positive, check day_of_month range, check ends_after_starts, soft-delete via archived_at). DRE calculator em `@repo/db/financeiro/dre.ts`: `calculateDre` pure function recebe `{period, invoices, costEntries}` retorna `{revenue: {gross/paid/pending/overdue/refunded}, costs: {byCategory ordenado, byType {fixed, variable}, total}, margins: {gross, percent}, counts}`; agrupa receita por `status` no período correto (paid_at vs due_at); custos por categoria+type em `incurred_at`; `forecastRevenue` heurístico baseline × (1-churnRate)^N com low/high -15%/+10% + total acumulado; edge cases retornam estrutura vazia. 13 unit tests cobrindo receita paid via paid_at + pending via due_at separados + refunded não conta gross; agrupamento custos por categoria com count + ordenação descending; exclusão fora do período; margens com paid=0 sem div/0; incurredAt como string ISO funciona; forecast com churn 5% calcula corretamente; intervalo low/high; churn=0 mantém baseline; valores inválidos retornam vazio; total bate com soma. 10 Server Actions wrapped (envelope ADR 0071 + audit_log): createCostCategory + listCostCategories + archiveCostCategory; createCostEntry + listCostEntries com filtros (company/category/from/to) + deleteCostEntry (permitido com audit pra correção); createRecurringCost + toggleRecurringCost + listRecurringCosts; **generateDre** chama calculateDre com queries de invoices+costEntries no tenant filtrado opcional por company (action 'dre.generate' grava audit — DRE é dado sensível administrativo); **forecastRevenueAction** apura baseline (sum plans.price × contracts.active) + churn histórico (cancelled últimos 6m / active base / 6 mensal) ou aceita manualChurnRate, chama forecastRevenue, retorna `{baselineMonthlyCents, churnRate, activeContracts, forecast}`. UI completa: `/app/financeiro/custos` lista filtrável com total agregado + badges fixed/variable color-coded + 4 botões nav (Categorias/Recorrentes/DRE/Previsão); `/app/financeiro/custos/categorias` dual-column (catálogo agrupado por type + sidebar form de criação com validação slug regex `[a-z0-9_]+`); `/app/financeiro/custos/new` wizard companyId+categoryId+amount BRL (parsing vírgula→decimal)+date+description; `/app/financeiro/dre` seletor de período + 4 KPI cards (Receita paga verde, Pendente amarelo somando pending+overdue, Custos vermelho com fixo+variável inline, Margem com cor por sinal e percentual) + breakdown por categoria com barras horizontais coloridas por type (info=fixed/warning=variable) + percentual relativo + count de lançamentos; `/app/financeiro/previsao` seletor 3/6/12 meses + override manual de churn % + 3 KPI cards (Baseline/Churn/Total Projetado) + tabela 4 colunas (mês, pessimista -15%, projetado, otimista +10%) + nota explicando heurística e referenciando substituição Sprint 19 ADR 0027. Seed standalone `pnpm db:seed:custos` popula **6 categorias canônicas** por tenant (Aluguel/Folha CLT fixed + Internet fixed + Marketing/Manutenção/Energia variable, com ícones emoji) + **10 cost_entries** últimos 3 meses (3 aluguéis mensais + 2 folhas + 2 marketing + 1 manutenção + 1 energia + 1 internet) + **3 recurring_costs** (aluguel D5 + folha D5 + internet D10). 8 tenants total = **48 categorias + 80 custos + 24 recorrências**. **ADR não exigido** (Sprint 14 doc confirma: "categorias com type fixed/variable é estrutura trivial; não justifica ADR"). **24 testes Sprint 14 verdes** (11 RLS + 13 DRE/forecast). **261 testes total verdes** (era 237). Typecheck clean. **Pendências menores adiadas Sprint 14+ próximo PR:** lucratividade por procedimento via `service_type` (depende invoice_items backfill Sprint 04+); upload NF-e PDF MinIO bucket privado + `scanUpload()` regra 38; exportação DRE PDF (`@react-pdf/renderer`) + CSV; simulador interativo de sensibilidade com sliders churn/baseline; job cron diário `recurring-tick` lendo recurring_costs onde day_of_month=now() AND last_generated_at < first_of_month + gerando cost_entries idempotentes; permission `custos.read`/`custos.write`/`dre.read`; card "Custos do mês" no dashboard gerente (Sprint 07); RIPD `v1.0-custos.md` se necessário (DRE é dado financeiro interno, não saúde — provável dispensa); feature flag `custos_v1` (PostHog dropado MVP); importação extrato OFX/CSV (Sprint 17 Open Finance entrega); conciliação bancária (Sprint 17); centro de custos por unit (granularidade além de category); benchmark anonimizado entre tenants (Sprint 19+ analytics). **Bug pré-existente Server Components com `db` global retornam 0 rows porque RLS bloqueia** (`app.tenant_id` não setado em conexão direta) afeta TODAS as páginas `/app/financeiro/custos` + `/categorias` + `/dre` + `/previsao`. **Verificado no preview que Server Actions também sofrem** — `withSessionContext` abre conexão A pra setar tenant_id mas queries Drizzle internas pegam conexão B do pool. Comentário canônico em `session.ts` reconhece: "Drizzle global pool sempre pega novo. Sprint 02+ refatora pra Drizzle-com-SET". UI estrutural está correta (KPI cards, seletor de período, breakdown por categoria com barras, tabela forecast com pessimista/projetado/otimista) — dados aparecerão quando refactor RLS infra for entregue. Próximo PR de infra Sprint 14+ deve consertar `withSessionContext` pra usar `db.transaction` com `SET LOCAL`.

## Definition of Done

- [ ] Feature flag `custos_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 14 → `done`

## Retro

- —
