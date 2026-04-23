# Sprint 16 — Geral · Rateio entre filiais + Lançamentos intercompany

- **Área:** geral
- **Início:** planejado (depois do Sprint 15)
- **Fim planejado:** +2 semanas
- **Status:** planejado
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

- —

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
