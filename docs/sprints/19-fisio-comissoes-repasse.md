# Sprint 19 — Fisio · Comissões e Repasse de Profissional

- **Área:** fisio (aproveitável para Academia — personal trainer)
- **Início:** planejado (depois do Sprint 18)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #21

## Goal

Cálculo automático de comissão/repasse por profissional (fisio autônomo, personal trainer, nutri contratado) com base em atendimentos realizados, faturamento pago e/ou recebido de convênio. Fechamento mensal + relatório por profissional + geração de lançamento para pagamento.

## Critério de aceite

- Cada profissional tem `professional_contracts` (um ou mais) com condições: `kind` (percent_faturamento / percent_recebido / fixo_por_atendimento / tabela_por_servico), `default_percent` ou `default_amount_cents`, `overrides` por `service_type`/`tuss_code`
- Quando atendimento é realizado + pago (ou convênio paga), cálculo dispara criando `commission_entries`
- Abatimento de comissão por cancelamento/no-show/glosa configurável
- Fechamento mensal: `commission_periods` agrega entries do mês → valor final a pagar ao profissional
- Aprovação manual do fechamento por gerente (status `draft` → `approved` → `paid`)
- Geração de lançamento pagável via Asaas (transferência ou Pix) — reusa infra do Sprint 04
- Relatório por profissional: atendimentos × valor faturado × comissão × pendências
- Respeita Regra 25 (franchise — profissional de uma company não recebe de atendimento em outra company)
- Teste E2E: fisio faz 10 atendimentos, 8 são pagos, 1 é glosado; cálculo → fechamento → pagamento
- Seed: 3 profissionais + contratos com condições diferentes

## Dependências

- Sprint 04 (pagamentos — fonte do "recebido")
- Sprint 16 (consultas — atendimento realizado)
- Sprint 17 (evolução — sessão fisio)
- Sprint 18 (faturamento convênios — comissão pode ser sobre recebido líquido)

## Decisões tomadas / ADRs esperados

- **ADR 0030 (esperado)** — Modelo de comissão: `professional_contracts` + `commission_rules` (overrides por tipo). Base de cálculo configurável (faturado vs recebido vs pago). Fechamento mensal com imutabilidade após aprovação.
- **Pergunta aberta:** tributação — o sistema deve calcular INSS/IR retidos ou só o valor bruto? Começar só bruto; tributação vira stretch ou sprint posterior.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Contratos profissionais (com/sem vínculo CLT)
- Regras de comissão (percentual/fixo/tabela)
- Cálculo automático de comissão por atendimento
- Fechamento mensal aprovado
- Pagamento integrado com Asaas

## Rotas Next.js

- `/app/rh/profissionais` — lista de profissionais + contratos
- `/app/rh/profissionais/[userId]/contratos` — contratos ativos
- `/app/rh/profissionais/[userId]/contratos/new` — cadastro
- `/app/rh/comissoes` — entries do período com filtros
- `/app/rh/fechamento` — periods abertos + aprovar
- `/app/rh/fechamento/[periodId]` — detalhe + exportar extrato PDF
- `/app/rh/relatorios` — por profissional, por procedimento, por convênio

## Server Actions + API Routes

Server Actions em `apps/web/app/rh/actions.ts`:

- `createProfessionalContract(userId, companyId, kind, rules)`
- `updateProfessionalContract(id, patch)` — cria nova versão
- `calculateCommissionForEvent(event)` — interno, disparado por evento de domínio
- `closePeriod(periodRef)` — agrega entries pendentes em `commission_periods`
- `approvePeriod(periodId)` — dispara pagamento Asaas
- `generateExtract(periodId)` — PDF do extrato do profissional

Eventos consumidos:
- `payment.received` (Sprint 04) → calcula comissão de `percent_recebido`
- `billing_guide.paid` (Sprint 18) → comissão convênio
- `appointment.completed` / `consulta.signed` / `evolucao.created` → comissão `fixo_por_atendimento`

## Schemas Drizzle (esperado)

Em `packages/db/schema/rh.ts`:

- `professional_contracts` — `id`, `tenant_id`, `company_id`, `user_id`, `effective_from`, `effective_to nullable`, `kind` enum (`percent_faturamento`, `percent_recebido`, `fixo_por_atendimento`, `tabela_por_servico`), `default_percent numeric nullable`, `default_amount_cents nullable`, `base` enum (`faturado`, `recebido_particular`, `recebido_convenio`, `misto`), `version int`, `active`
- `commission_rules` — `contract_id`, `service_type text nullable`, `tuss_code nullable`, `percent numeric nullable`, `amount_cents nullable`. Overrides ao default.
- `commission_entries` — `id`, `tenant_id`, `contract_id`, `user_id`, `source_event_ref text` (ex: `payment:uuid`, `guide:uuid`), `reference_amount_cents`, `commission_cents`, `percent_applied numeric nullable`, `service_type nullable`, `status` enum (`pending`, `included`, `excluded`, `reversed`), `earned_at`, `period_id nullable`
- `commission_periods` — `id`, `tenant_id`, `user_id`, `period_start`, `period_end`, `total_entries int`, `gross_total_cents`, `deductions_cents`, `net_total_cents`, `status` enum (`draft`, `approved`, `paid`, `cancelled`), `approved_by_user_id nullable`, `approved_at nullable`, `paid_at nullable`, `asaas_transfer_id nullable`

**RLS:** tenant_id + scope; profissional vê só os próprios; gerente vê da company; diretor vê tenant. Permission `rh.read`, `rh.write`, `rh.approve`.

## Eventos de domínio emitidos

- `commission.calculated` — `{ entry_id, user_id, commission_cents }`
- `commission.period_closed` / `commission.period_approved` / `commission.period_paid`
- `commission.entry_reversed` (quando glosa ou estorno ocorre depois)

## Commit (checklist)

- [ ] Schema Drizzle: `professional_contracts`, `commission_rules`, `commission_entries`, `commission_periods`
- [ ] RLS + testes (profissional vê só seus; franchise respeitado)
- [ ] Calculadora em `packages/db/rh/commission.ts` (pure function: `calculateCommission(event, contract) → entry`)
- [ ] Listeners nos eventos `payment.received`, `billing_guide.paid`, `appointment.completed`, `consulta.signed`, `evolucao.created`
- [ ] Handler de reversão em `payment.refunded`, `billing_glosa.received`
- [ ] Job mensal automático de fechamento (gerar `commission_periods` em draft)
- [ ] Workflow draft → approved → paid com audit
- [ ] Integração Asaas para transferência/Pix (reusa wrapper do Sprint 04)
- [ ] UI `/app/rh/*`
- [ ] Widget "comissão do mês" no dashboard do profissional em `/app` (home contextual Sprint 07)
- [ ] Extrato PDF detalhado
- [ ] Seed: 3 profissionais + 3 contratos distintos + 50 entries mock
- [ ] Testes unit da calculadora (todos os 4 `kind` × 3 bases × overrides)
- [ ] Testes E2E: fluxo atendimento → pagamento → comissão → fechamento → transferência
- [ ] Feature flag `rh_v1`
- [ ] ADR 0030 publicado

## Stretch

- [ ] Cálculo de INSS/IR retido automaticamente
- [ ] Holerite PDF com campos fiscais
- [ ] Simulação de comissão antes de fechar (o profissional vê projeção)
- [ ] Bônus/meta: se atingiu X atendimentos no mês, ganha Y adicional

## Log

- —

## Definition of Done

- [ ] Feature flag `rh_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] Transferência Asaas sandbox funcional
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 19 → `done`
- [ ] ADR 0030 publicado

## Retro

- —
