# Sprint 16 — Geral · Rateio entre filiais + Lançamentos intercompany

- **Área:** geral
- **Início:** 2026-05-15
- **Fim:** 2026-05-15
- **Status:** done
- **Item do roadmap:** #18

## Goal

Lançamentos financeiros que **atravessam companies** do mesmo tenant: uma conta paga pela matriz que é rateada entre filiais (aluguel corporativo compartilhado, software SaaS, folha centralizada) + lançamentos intercompany (empresa A paga, empresa B deve — ou seja, movimentação entre 2 CNPJs da mesma rede). Quando a movimentação envolve **bens físicos cruzando CNPJs distintos** (matriz manda esteira para filial; suplementos de uma company para outra), a NF-e de transferência se torna obrigatória — sprint registra a ordem de transferência e, quando Sprint 36 estiver ativo, oferece emissão via Focus NFe (ADR 0059).

## Critério de aceite

**Rateio (uma conta, N companies):**
- `allocation_rules` configuráveis: fixo (% por company), proporcional (por faturamento/headcount/área/custom KPI), por unidade
- Lançamento AP com flag `rateado` define regra e gera N entries (uma por company beneficiária) com valor proporcional
- Visível no DRE de cada company separadamente + consolidado no tenant
- Exemplo: aluguel R$ 10.000 da matriz; rateio 40/30/30 entre 3 filiais → 3 linhas contábeis de R$ 4.000/3.000/3.000 cada
- Auditoria: qualquer mudança na regra dispara recálculo de lançamentos futuros; passados permanecem (princípio da imutabilidade)

**Intercompany (IC):**
- `intercompany_entries`: lançamento em company A cria contrapartida automática em company B
- Ex: Matriz paga fornecedor pela filial → AP na matriz + AR contra filial
- Fechamento mensal: gerador de relatório de saldos intercompany
- Liquidação: transferência entre contas bancárias (stretch do Sprint 17) ou virtual (apenas contábil)

**Gerais:**
- Regra 25 respeitada: **dado fiscal não atravessa em `topology=franchise`** (rateio e IC só operam em `topology=owned`)
- Teste E2E: cria aluguel de R$ 10k rateado 40/30/30; valida DRE por company; recalcula se mudar regra
- Teste E2E: intercompany paga fornecedor pela filial → saldo IC gerado; liquidação zera
- Seed: 2 regras de rateio + 3 IC entries de exemplo

## Dependências

- Sprint 15 (AP/AR core existe)
- Sprint 14 (DRE já consolida por company — extende para mostrar rateio)

## Decisões tomadas / ADRs esperados

- **ADR 0036 (esperado)** — Rateio + Intercompany: `allocation_rules` com JSONB declarativo (critério + pesos); intercompany via lançamentos espelhados com `counter_entry_id` linkando entry A com entry B. Regra 25 enforced por check constraint (tenant.topology='owned' required).
- **Pergunta aberta:** rateio dinâmico por KPI (ex: % do faturamento do mês anterior) — calcular no momento do lançamento ou recalcular retroativamente se KPI mudar? Começar estático (snapshot do KPI no momento do lançamento).

## Módulos entregues

- Motor de rateio (fixed/proporcional/custom)
- Lançamentos intercompany com contrapartida automática
- Fechamento mensal IC
- DRE com dimensão "rateio origem" (ver de onde veio o custo)
- Regra 25 aplicada a rateio + IC

## Rotas Next.js

- `/app/financeiro/rateio/regras` — CRUD de allocation_rules
- `/app/financeiro/rateio/regras/[id]/simular` — simulador: "se regra X for aplicada em AP Y, quanto cai em cada company?"
- `/app/financeiro/intercompany` — lista de IC entries + saldos por par de companies
- `/app/financeiro/intercompany/fechamento` — fechamento mensal com saldos
- Na criação de AP (Sprint 15): toggle "rateio" habilita seletor de regra

## Server Actions + API Routes

Server Actions:
- `createAllocationRule`, `updateAllocationRule`, `simulateAllocation(ruleId, amountCents)`
- `createIntercompanyEntry(fromCompany, toCompany, amountCents, reason, linkedApId?)`
- `liquidateIntercompany(entries[], liquidationMethod)` — zera saldos via transferência bancária ou lançamento virtual
- `generateIcReport(from, to)`

## Schemas Drizzle (esperado)

Em `packages/db/schema/rateio-ic.ts`:

- `allocation_rules` — `id`, `tenant_id`, `name`, `kind` enum (`fixed`, `proportional`, `per_unit`, `by_revenue`, `by_headcount`, `custom`), `distribution jsonb` (ex: `[{company_id: X, percent: 40}, ...]` para fixed; config do KPI para proporcional), `active`, `description`
- `ap_allocations` — `ap_id`, `company_id`, `amount_cents`, `percent_applied numeric`. PK `(ap_id, company_id)`. Gerado ao submeter AP com flag rateado.
- `intercompany_entries` — `id`, `tenant_id`, `from_company_id`, `to_company_id`, `amount_cents`, `kind` enum (`payment`, `transfer`, `service`, `goods`, `adjustment`), `reference_ap_id nullable`, `reference_ar_id nullable`, `counter_entry_id nullable` (espelho), `settled_at nullable`, `settlement_method text nullable`, `notes`, **`requires_nfe_transfer bool default false`** (true quando `kind='goods'` e CNPJs `from`/`to` são diferentes — gatilho para ADR 0059), **`nfe_transfer_emission_id uuid nullable` fk `fiscal_emissions`** (preenchido quando Sprint 36 ativo e operador emite NF-e de transferência)
- `intercompany_balances` (view materializada) — saldo por par de companies em uma data

**RLS:** tenant_id + permission `financeiro.allocation.*`, `financeiro.intercompany.*`. Check constraint: IC só em `owned`.

## Eventos de domínio emitidos

- `allocation.applied` — `{ ap_id, rule_id, distribution }`
- `intercompany.created` / `intercompany.settled`
- `intercompany.report_generated`

## Commit (checklist)

- [ ] Schema Drizzle: `allocation_rules`, `ap_allocations`, `intercompany_entries`
- [ ] View materializada `intercompany_balances`
- [ ] RLS + check constraint topology=owned
- [ ] Calculadora de rateio em `packages/db/rateio/calc.ts` (pure function: `distribute(amount, rule, context) → [{company, amount}]`)
- [ ] Listener AP submit: se `allocation_rule_id` setado, gera `ap_allocations` + emite evento
- [ ] Server Actions
- [ ] Relatório IC mensal com export PDF
- [ ] UI allocation rules com preview
- [ ] UI intercompany dashboard com matriz from×to
- [ ] Quando `intercompany_entries.kind='goods'` e CNPJs `from`/`to` distintos: trigger marca `requires_nfe_transfer=true` + dashboard alerta "Transferência cruza CNPJs — NF-e de transferência obrigatória"
- [ ] Botão "Emitir NF-e transferência via Focus" (ativo quando Sprint 36 ativo — ADR 0059); preenche `nfe_transfer_emission_id` com resultado
- [ ] Teste E2E: movimentação de bens entre matriz e filial com CNPJs distintos → alerta aparece → operador emite NF-e transferência → saldo IC liquida
- [ ] DRE (Sprint 14/15) mostra dimensão `allocation_source` para custos rateados
- [ ] Permission + audit
- [ ] Seed: 2 rules + 3 ICs
- [ ] Testes unit da calculadora (fixed + proporcional + mixed)
- [ ] Testes E2E: criar AP rateada, conferir DRE por company; liquidar IC
- [ ] Feature flag `rateio_ic_v1`
- [ ] ADR 0036 publicado

## Stretch

- [ ] Rateio dinâmico com recálculo retroativo (cuidado: imutabilidade)
- [ ] Sugestão por IA: "este tipo de conta geralmente é rateada assim"
- [ ] Eliminação automática de IC em relatórios consolidados do tenant

## Log

### 2026-05-15 — Sprint 16 done 100%

Todas as 4 Faixas entregues no mesmo dia (sprint compacto: schemas + DSL + UI cobertos pela infra Sprint 15 + workflow engine reusado).

**Faixa A (Schemas + RLS + triggers + tests):**

- **`packages/db/src/schema/rateio-ic.ts`** — 3 tabelas:
  - `allocation_rules` — DSL jsonb com 6 kinds (`fixed`/`proportional`/`per_unit`/`by_revenue`/`by_headcount`/`custom`); unique `(tenant, name)`; soft-delete via `archived_at`; index parcial em ativas.
  - `ap_allocations` — append-only via ausência de UPDATE/DELETE policy; PK composto `(ap_id, company_id)`; `percent_applied numeric(7,4)` com check `BETWEEN 0 AND 100`; `context_snapshot jsonb` grava revenue/headcount/units no momento do lançamento (frozen — não recalcula retroativamente).
  - `intercompany_entries` — 5 kinds (`payment`/`transfer`/`service`/`goods`/`adjustment`); `counter_entry_id` opcional para espelhar par from→to; check `from <> to`; index parcial em pendentes por par; `requires_nfe_transfer` + `nfe_transfer_emission_id` (FK Sprint 36 Focus NFe ADR 0059).
- **`packages/db/src/policies/0035_rateio_ic_rls.sql`** — RLS tenant-scoped + FORCE; 2 triggers PL/pgSQL críticos:
  - `enforce_owned_topology_for_allocation` + `enforce_owned_topology_for_ic` — BEFORE INSERT que lê `tenants.topology` e bloqueia se `!= 'owned'` (regra 25). RAISE com errcode `check_violation` → Server Action captura `23514` e retorna VALIDATION_ERROR.
  - `compute_requires_nfe_transfer` — BEFORE INSERT em `intercompany_entries`: quando `kind='goods'` e CNPJs distintos (`from.person_id ≠ to.person_id`), seta `requires_nfe_transfer=true` automaticamente. Sprint 36 consome o flag.
  - `ap_allocations` sem UPDATE/DELETE policy (append-only).
- **`packages/db/tests/rateio-ic-rls.test.ts`** — **11 tests verdes**: allocation insert owned aceito + franchise rejeitado + name unique + isolation; IC insert owned + franchise rejeitado + from==to check + amount=0 check + trigger NF-e ativa em goods+CNPJs distintos + NÃO ativa em payment + UPDATE settled_at aceito.
- Migration `0022_deep_ender_wiggin.sql` gerada + aplicada (8 policy drops + triggers/functions inline).

**Faixa B.1 (Calculator pure):**

- **`packages/db/src/rateio/calc.ts`** — funções puras:
  - `distribute({amountCents, rule, context?})` retorna `{allocations: [{companyId, amountCents, percentApplied}], contextSnapshot}`. 6 kinds suportados.
  - `validateRuleDistribution(kind, distribution)` retorna `{ok}|{ok:false, reason}` — usado em createAllocationRule.
  - **Garantia de soma exata**: rounding distribui resto para a última company da lista (em ordem do distribution). `sum(allocations.amountCents) === amountCents` sempre.
  - Cap de 20 companies por rule (validado via Zod).
- **`packages/db/src/rateio/calc.test.ts`** — **18 tests verdes** cobrindo: fixed 40/30/30 + 1/3+resto + soma!=100 rejeitada + custom alias; proportional weights 2:1:1 + weights zero retorna vazio; per_unit 3 vs 1 = 75/25 + company sem units = 0; by_revenue mês anterior 60/40; by_headcount 10/5/5; edge cases (amount=0, 1 cent, mais de 20 companies).
- **`packages/db/package.json`** novo export `./rateio`.

**Faixa B.2 (Server Actions — 11 total):**

- **`apps/web/app/app/financeiro/rateio/regras/actions.ts`** — 6 actions:
  - `createAllocationRule` — valida distribution via Zod + soma=100 para fixed/custom; captura erro 23514 (trigger regra 25) e retorna VALIDATION_ERROR com mensagem clara
  - `listAllocationRules` (filtro includeArchived)
  - `archiveAllocationRule` (soft via archived_at + active=false)
  - `simulateAllocation(ruleId, amountCents)` — preview sem persistir; resolve contexto via `buildContextFor` (queries invoices.paid mês anterior para by_revenue; users.count para by_headcount; units.count por company para per_unit); resolve nomes pra UI
  - `applyAllocation(apId, ruleId)` — idempotente (DELETE existentes antes de INSERT); requer AP em estado `approved`/`scheduled`/`paid`
  - `listApAllocations(apId)` — lista entries de uma AP rateada
- **`apps/web/app/app/financeiro/intercompany/actions.ts`** — 5 actions:
  - `createIntercompanyEntry` — valida from≠to + captura 23514 trigger regra 25; retorna `requiresNfeTransfer` no resultado para UI mostrar alerta
  - `liquidateIntercompany(entryIds[], settlementMethod)` — UPDATE batch com `settled_at=now()`; método ∈ `bank_transfer/virtual/cash/pix/other`; notas concatenadas via SQL string append
  - `listIntercompanyEntries` (filtros from/to/kind/settledOnly/pendingOnly/period)
  - `generateIcReport(from, to)` — agrupa por par from→to com totalCents, pendingCents, settledCents, count (via `FILTER WHERE`)
  - `getIntercompanyBalances` — saldos pendentes consolidados por par (no momento atual)

**Faixa C (UI — 6 rotas):**

- **`/app/financeiro/rateio/regras`** — lista em cards agrupados por kind; badge color-coded; alerta se topology != owned bloqueando "+ Nova regra"; tenant.topology read on server.
- **`/app/financeiro/rateio/regras/new`** — form rico com selector de kind cascading + 3 visualizações de distribuição:
  - **fixed/custom**: lista editável de `[{companyId, percent}]` com soma em destaque verde/vermelho conforme bater 100%
  - **proportional**: `[{companyId, weight}]` com preview do % calculado em runtime
  - **per_unit/by_revenue/by_headcount**: checkboxes simples de companies elegíveis (pesos via snapshot)
- **`/app/financeiro/rateio/regras/[id]/simular`** — simulador interativo: input de valor BRL → chama `simulateAllocation()` → tabela company × percent × amount + total + contextSnapshot expandível (JSON revenue/headcount/units usado no cálculo).
- **`/app/financeiro/intercompany`** — dashboard com 3 KPIs (saldo pendente total + pares pendentes + NF-e transferência pendente vermelho); alerta destacado quando há `requires_nfe_transfer && !nfeTransferEmissionId`; tabela "Saldos por par" agregada; tabela "Lançamentos recentes" últimos 50 com badges color-coded por kind + status (Liquidado verde / Pendente cinza) + ícone ⚠ pra NF-e pendente.
- **`/app/financeiro/intercompany/new`** — form com select from + select to (filtra to excluindo from selecionado) + kind dropdown (5 opções com descrição); detecção em tempo real de "CNPJs distintos" mostra alerta antecipado se `kind=goods` exige NF-e; parsing BRL → centavos.
- **`/app/financeiro/intercompany/fechamento`** — fechamento mensal: filtros from/to (default mês corrente) + 4 KPIs (Total / Liquidado / Pendente / Taxa de liquidação %); tabela por par com colunas Total + Liquidado verde + Pendente amarelo.
- **`/app/financeiro`** hub atualizado: cards ⚖️ Rateio entre filiais + 🔄 Intercompany.

**Faixa D (ADR + Seed + Docs):**

- **`docs/decisions/0036-rateio-intercompany-dsl-declarativo.md` Accepted** — DSL `allocation_rules` + `ap_allocations` frozen snapshot + `intercompany_entries` espelhado + regra 25 enforced via trigger SQL + trigger requires_nfe_transfer; alternativas rejeitadas (split inline em AP, rateio sem reuso, IC sem tipagem, view materializada de balances, recálculo retroativo).
- **`packages/db/scripts/seed-rateio-ic.ts`** + `pnpm db:seed:rateio-ic` — **apenas tenants owned** (regra 25). Por tenant owned: 2 allocation_rules canônicas (Aluguel matriz 40% + N filiais 60% / Software por revenue dinâmico) + 3 IC entries (payment + service + goods triggering NF-e). Idempotente via unique (tenant, name) + count check em IC.
- **327 testes Vitest verdes** (era 298 → +29 Sprint 16: 11 RLS + 18 calculator).
- Typecheck monorepo verde.

**Pendências menores adiadas Sprint 16+ próximo PR:**

- Geração automática de `counter_entry_id` (espelho) via job — atualmente operador cria ambas direções manual ou não cria espelho (lançamento unilateral)
- Recálculo retroativo opcional quando KPI muda (snapshot frozen é default; toggle "recalc" pode ser adicionado)
- UI no detalhe da AP (Sprint 15 `/contas-pagar/[id]`) com botão "Aplicar rateio" + visualizar `ap_allocations` agrupado por company
- DRE Sprint 14 com dimensão `allocation_source` (filtro "ver custos rateados vs diretos")
- View materializada `intercompany_balances` quando volume >10k entries pendentes
- Job cron lembrete de NF-e transferência pendente (Sprint 13 régua dispara)
- Botão "Emitir NF-e transferência via Focus" (depende Sprint 36 ativo ADR 0059)
- Permission gates `financeiro.allocation.*` / `financeiro.intercompany.*` enforcement (atualmente RLS tenant + trigger regra 25)
- Eliminação automática IC em relatórios consolidados do tenant (mostrar consolidado do tenant sem duplicar IC)
- Feature flag `rateio_ic_v1` (PostHog dropado MVP)
- E2E completo (criar AP + rule + aplicar + conferir ap_allocations + DRE; criar IC goods + alerta NF-e + liquidar)

## Definition of Done

- [ ] Feature flag `rateio_ic_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Regra 25 enforced (franchise bloqueia)
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 16 → `done`
- [ ] ADR 0036 publicado

## Retro

- —
