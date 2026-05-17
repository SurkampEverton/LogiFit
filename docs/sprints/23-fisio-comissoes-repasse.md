# Sprint 23 — Fisio · Comissões e Repasse de Profissional

- **Área:** fisio (aproveitável para Academia — personal trainer)
- **Início:** planejado (depois do Sprint 22)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #21

## Goal

Cálculo automático de comissão/repasse por profissional (fisio autônomo, personal trainer, nutri contratado) com base em atendimentos realizados, faturamento pago e/ou recebido de convênio. Fechamento mensal + relatório por profissional + geração de lançamento para pagamento.

## Critério de aceite

- Cada profissional tem `professional_contracts` (um ou mais) com condições: `kind` (percent_faturamento / percent_recebido / fixo_por_atendimento / tabela_por_servico), `default_percent` ou `default_amount_cents`, `overrides` por `service_type`/`tuss_code`
- **Gate de registro profissional ativo (ADR 0055):** `createProfessionalContract` valida que a `person_id` informada tem ao menos 1 `professional_registrations` com `situation='active'` coerente com o tipo de serviço do contrato (ex: contrato de fisio exige CREFITO ativo; contrato de personal exige CREF ativo). Erro explícito + link para `/app/pessoas/[id]/registros` se faltar. Mapping `service_type → council_body` tabelado em `packages/db/rh/council-mapping.ts`
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

- Sprint 01b (`professional_registrations` — gate de registro ativo)
- Sprint 04 (pagamentos — fonte do "recebido")
- Sprint 20 (consultas — atendimento realizado)
- Sprint 21 (evolução — sessão fisio)
- Sprint 22 (faturamento convênios — comissão pode ser sobre recebido líquido)

## Decisões tomadas / ADRs esperados

- **ADR 0086 (esperado)** — Modelo de comissão: `professional_contracts` + `commission_rules` (overrides por tipo). Base de cálculo configurável (faturado vs recebido vs pago). Fechamento mensal com imutabilidade após aprovação. (Numeração ≥0080 conforme [roadmap §convenção fora-de-sprint](../roadmap.md) — 0030 já alocado a Sprint 22 pipeline atualização TISS.)
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
- `billing_guide.paid` (Sprint 22) → comissão convênio
- `appointment.completed` / `consulta.signed` / `evolucao.created` → comissão `fixo_por_atendimento`

## Schemas Drizzle (esperado)

Em `packages/db/schema/rh.ts`:

- `professional_contracts` — `id`, `tenant_id`, `company_id`, **`person_id uuid not null`** (FK `persons` do Sprint 01a — via [ADR 0047](../decisions/0047-cadastro-central-persons.md); identifica o profissional independente de ter login), **`user_id uuid nullable`** (preenchido quando profissional tem login — então comissão aparece no seu dashboard), `effective_from`, `effective_to nullable`, `kind` enum (`percent_faturamento`, `percent_recebido`, `fixo_por_atendimento`, `tabela_por_servico`), `default_percent numeric nullable`, `default_amount_cents nullable`, `base` enum (`faturado`, `recebido_particular`, `recebido_convenio`, `misto`), `version int`, `active`. Check: `user_id IS NULL OR users.person_id = professional_contracts.person_id` (consistência entre pessoa do contrato e pessoa do login).
- `commission_rules` — `contract_id`, `service_type text nullable`, `tuss_code nullable`, `percent numeric nullable`, `amount_cents nullable`. Overrides ao default.
- `commission_entries` — `id`, `tenant_id`, `contract_id`, `person_id` (denormalizado para relatórios rápidos), `user_id nullable`, `source_event_ref text` (ex: `payment:uuid`, `guide:uuid`), `reference_amount_cents`, `commission_cents` (bruto), **`tax_nature_id uuid nullable` fk `tax_natures`** (ADR 0061 — resolvido automaticamente conforme `person.kind` + regime do profissional: PF autônomo → `autonomo_rpa_pf`, PJ → `servico_prestado_pj_geral`, Simples → `simples_nacional_anexo_iii`), **`retention_total_cents bigint default 0`**, **`net_amount_cents bigint`**, `percent_applied numeric nullable`, `service_type nullable`, `status` enum (`pending`, `included`, `excluded`, `reversed`), `earned_at`, `period_id nullable`
- `commission_periods` — `id`, `tenant_id`, `person_id`, `user_id nullable`, `period_start`, `period_end`, `total_entries int`, `gross_total_cents`, `deductions_cents`, `net_total_cents`, `status` enum (`draft`, `approved`, `paid`, `cancelled`), `approved_by_user_id nullable`, `approved_at nullable`, `paid_at nullable`, `asaas_transfer_id nullable`. Pagamento via Asaas usa chave PIX de `persons` ou conta bancária registrada em `suppliers` se o profissional também for supplier.

**RLS:** tenant_id + scope; profissional vê só os próprios; gerente vê da company; diretor vê tenant. Permission `rh.read`, `rh.write`, `rh.approve`.

## Eventos de domínio emitidos

- `commission.calculated` — `{ entry_id, user_id, commission_cents }`
- `commission.period_closed` / `commission.period_approved` / `commission.period_paid`
- `commission.entry_reversed` (quando glosa ou estorno ocorre depois)

## Commit (checklist)

- [ ] Schema Drizzle: `professional_contracts`, `commission_rules`, `commission_entries`, `commission_periods`
- [ ] RLS + testes (profissional vê só seus; franchise respeitado)
- [ ] Calculadora em `packages/db/rh/commission.ts` (pure function: `calculateCommission(event, contract) → entry`) com enriquecimento de retenções: chama `calculateRetentions()` do Sprint 15 (ADR 0061) conforme `tax_nature_id` resolvido pelo tipo do profissional (PF autônomo → RPA com INSS 11%/IRRF progressivo; PJ → PIS/COFINS/CSLL/IRRF; Simples → sem retenção federal); grava linhas em `tax_retentions` com `source_type='commission_entry'`
- [ ] UI de comissão mostra **decomposição**: "Bruto R$ 2.500 → INSS R$ 275 + IRRF R$ 64,12 + ISS retido R$ 50 = Líquido R$ 2.110,88"
- [ ] Extrato do profissional (`generateExtract`) inclui detalhamento de retenções; comprovante da retenção do INSS (GPS) e IRRF (DARF) sugerido para contador do tenant gerar
- [ ] Teste E2E: contrato com fisio autônomo PF → 10 atendimentos → período fecha → retenções calculadas corretamente + `commission_periods.net_total_cents` reflete líquido
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
- [ ] ADR 0086 publicado

## Stretch

- [ ] Cálculo de INSS/IR retido automaticamente
- [ ] Holerite PDF com campos fiscais
- [ ] Simulação de comissão antes de fechar (o profissional vê projeção)
- [ ] Bônus/meta: se atingiu X atendimentos no mês, ganha Y adicional

## Log

- **2026-05-17 — Faixa A entregue:** 4 schemas (professional_contracts versionado + commission_rules + commission_entries @volume 18M+/ano com idempotência via unique source_event_ref + commission_periods pipeline) + RLS tenant-scoped + via JOIN + 14 RLS tests; migration `0029_ambiguous_venus.sql`.
- **2026-05-17 — Faixa B.1 entregue:** lib pura calculateCommission cobrindo 4 kinds × 4 bases + resolveRule priority asc + aggregateEntries com 25 unit tests (compat eventos / overrides / vigência / status filter).
- **2026-05-17 — Faixa B.2 entregue:** 10 Server Actions wrapped — createProfessionalContract com gate ADR 0055 + mapping council por service_type; calculateCommissionForEvent idempotente; closePeriod agrega pending→included; approvePeriod transição draft→approved; markPeriodPaid placeholder Asaas.
- **2026-05-17 — Faixa C entregue:** 4 rotas (/rh hub 5 KPIs + /profissionais + /comissoes filtros + /fechamento filtros).
- **2026-05-17 — Faixa D entregue:** ADR 0086 Proposed (4 kinds × 4 bases + versionamento + imutabilidade + reversão entry espelhada + tributação placeholder); seed-rh 3 perfis × 7 tenants = 21 contratos + 21 rules + 105 entries. **602 tests verdes** (era 563, +39 Sprint 23: 14 RLS + 25 unit).
- **Quebra 23a/23b:** sem `calculateRetentions` real (ADR 0061 não-integrado) + sem Asaas transfer + sem holerite PDF + sem cron mensal, 23a focou em schema + calculadora pura + workflow básico. 23b integra todas as pontas.

## Definition of Done

- [x] Feature flag `rh_v1` — **adiado Sprint 23b** (sem retenção real + Asaas + RIPD não pode ir a produção)
- [x] Testes unit (25) + RLS (14) verdes; E2E adiado 23b com Asaas sandbox + retenções reais
- [x] RLS verificada (14 tests cobrindo isolation + CHECK + unique + via JOIN)
- [x] Migration `0029_ambiguous_venus.sql` aplicada
- [x] Transferência Asaas — **adiado Sprint 23b** (markPeriodPaid no MVP só registra ID externo)
- [x] CHANGELOG atualizado
- [x] Roadmap: sprint 23 → `done (23a core)`
- [x] [ADR 0086](../decisions/0086-modelo-comissao-profissional.md) publicado **Proposed**

## Retro

- **Acertos:** calculadora pura (lib `commission.ts`) com 25 testes cobre toda matriz 4 kinds × 4 bases sem precisar de DB. Server Actions ficam thin (CRUD + chamada da lib + persistência). Versionamento via `version` column + `(person, company, service_type, version)` unique resolve necessidade de "histórico" sem tabela `commission_history` separada.
- **Decisão controversa:** reversão via **entry espelhada** ao invés de modificar entry original. Custo: history fica mais comprida (2 rows por estorno). Benefício: imutabilidade total — period antigo (já approved/paid) não muda nunca. Aceito pelo gate de auditoria fiscal (5 anos retenção mínima).
- **Erros:** schema CHECK `pc_default_consistent` é complexo (3 cláusulas OR) — testes RLS cobrem cada caminho. Lição: CHECK constraints complexas precisam de unit test específico por cláusula.
- **Aprendizados:** drizzle `numeric` em string → JS Number cast manual (`Number(r.percent)`). Mais explícito que jsonb-as-number aninhado. Fácil de errar; capturado pelo typecheck.
- **Próximo Sprint 24:** estoque (descartáveis + revenda) + POS + inventário. Depende deste sprint para comissão sobre venda; ADR 0087 reservado para método de custo (PEPS vs custo médio).
