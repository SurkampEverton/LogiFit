# Sprint 05 — Geral · Ofertas comerciais (promoções, pacotes, referrals, cashback)

- **Área:** geral
- **Início:** planejado (depois do Sprint 04)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #10

## Goal

Camada comercial em cima do financeiro: **catálogo de serviços (`services`)** + **construtor visual de planos** + **preços contextuais (`service_prices`)** + promoções (cupons/descontos) + bundles (combos cross-vertical) + referrals + cashback. Tudo aplicável em `contracts` e `invoices` respeitando `topology` e `financial_mode`. Fundamenta modelo comercial via [ADR 0068](../decisions/0068-catalogo-servicos-precos-contextuais-link-financeiro.md).

## Critério de aceite

- **Catálogo `services`** (ADR 0068): tenant cadastra serviços (sessão fisio, consulta nutri, mensalidade academia, avaliação física, personal avulso, produto do estoque) com preço avulso default, duração, vertical, CBO/TUSS opcional, `chart_account_id`, `tax_nature_id` opcional, `stock_item_id` opcional
- **`plan_items`** compõe plano a partir do catálogo: `included_quantity` (null=ilimitado), `period` (per_cycle/total/lifetime), `extra_price_cents` override, `extra_allowed` hard limit
- **`service_prices`** — tabela única de overrides contextuais (ADR 0068): `context ∈ {default, plan, contract, member_custom, insurance, promotion, company}`; função `resolveServicePrice(input)` retorna preço final com fonte + explicação para audit
- **5 telas admin** (ADR 0068):
  - `/app/settings/servicos` — CRUD do catálogo
  - `/app/settings/planos` — construtor de plano com form + modal "Adicionar serviço" (decisão 1B: sem drag-drop)
  - `/app/settings/planos/[id]/preview` — preview como member veria
  - `/app/settings/precos` — lista de overrides contextuais com filtros
  - `/app/settings/promocoes` — cupons (auto-gera linhas em `service_prices` com `context='promotion'`)
- Promoções: criar cupom com `code`, tipo (`percent`, `fixed`, `trial_days`), validade, teto de uso, planos aplicáveis
- Aplicação de cupom no checkout diminui `invoice.amount_cents` e registra `promotion_uses`
- Pacotes: cadastrar bundle composto de N `plan_items` com `quantity` (ex: "plano mensal + 4 PTs + 1 consulta nutri")
- Matrícula em bundle gera 1 `contract` "pai" + `appointment_credits` para os itens consumíveis
- Créditos consumidos ao agendar (emite `credit.consumed`); expiram conforme política do bundle
- Referrals: member gera código único; novo matriculado com código aplica desconto na 1ª mensalidade (via `promotions`) e creditata recompensa para o referrer
- Cashback (stretch): % de valor pago vira crédito futuro (aplicável em próxima cobrança)
- Cupons **não stackable** por padrão; bundle não combina com cupom de `plan_items` filhos
- Todo desconto grava `audit_log` com `granted_by` + razão
- Teste E2E: cupom expirado é rejeitado; teto esgotado é rejeitado; referrer e referred ambos recebem benefício; crédito de PT vence e bloqueia agendamento
- Seed: 3 promoções + 2 bundles + 1 referral ativo por tenant de cenário canônico

## Dependências

- Sprint 04 (Financeiro core: `plans`, `contracts`, `invoices`)
- Sprint 03 (Agenda: créditos consumidos em `createAppointment`)

## Decisões tomadas / ADRs esperados

- **ADR 0020 (esperado)** — Ofertas comerciais: `promotions`, `plan_items` (bundle composition), `appointment_credits` e `referrals` como entidades independentes ao invés de colunas em `plans`/`contracts`. Justifica: isolamento de histórico, auditoria limpa, regras de stackability em um só lugar.
- **Pergunta aberta:** validade default do crédito de PT (30d? 60d? alinhado com `billing_cycle`?). Fica como config do bundle.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral) (serão adicionados neste sprint):

- Promoções (cupons e descontos temporais)
- Pacotes (bundles) + créditos de serviço
- Referrals (indicação premiada)
- Cashback (stretch)

## Rotas Next.js

- `/app/financeiro/promocoes` — lista + CRUD
- `/app/financeiro/promocoes/[id]` — detalhe + estatísticas de uso
- `/app/financeiro/pacotes` — lista + CRUD
- `/app/financeiro/pacotes/[id]` — composição + alunos ativos
- `/app/financeiro/referrals` — lista de códigos ativos + performance
- `/app/members/[id]/creditos` — saldo de créditos do member
- `/app/members/[id]/referral` — código do member + convites realizados

## Server Actions + API Routes

Server Actions em `apps/web/app/financeiro/ofertas/actions.ts`:

- `createPromotion(input)` / `updatePromotion` / `archivePromotion`
- `applyPromotion(contractId | invoiceId, code)` — valida regras, grava `promotion_uses`, aplica desconto
- `createBundle(input, items)` — bundle é um `plan` com `kind='bundle'` + linhas em `plan_items`
- `subscribeBundle(memberId, bundleId, startDate)` — cria contrato + cria `appointment_credits`
- `consumeCredit(creditId, appointmentId)` — debita saldo, emite `credit.consumed`
- `createReferralCode(memberId, rewardPromotionId)` — gera código único
- `applyReferral(code, newContractId)` — aplica `promotion` correspondente; dispara `referral.converted`

## Schemas Drizzle (esperado)

Em `packages/db/schema/ofertas.ts`:

- `promotions` — `id`, `tenant_id`, `code text unique` (por tenant), `kind` enum (`percent`, `fixed`, `trial_days`), `value int`, `valid_from`, `valid_to`, `max_uses int nullable`, `uses_count int default 0`, `applicable_plan_ids uuid[]`, `min_amount_cents nullable`, `stackable bool`, `active`, timestamps
- `promotion_uses` — `id`, `tenant_id`, `promotion_id`, `contract_id nullable`, `invoice_id nullable`, `discount_cents`, `used_at`, `used_by_user_id` (operador ou self-service)
- `plans` **ganha coluna** `kind enum ('plan','bundle') default 'plan'`
- `plan_items` — `bundle_plan_id`, `child_plan_id nullable`, `service_type text nullable` (ex: `personal_training`, `nutri_consulta`), `quantity int`, `credit_validity_days int nullable`. PK `(bundle_plan_id, idx)` — ordem do item no bundle
- `appointment_credits` — `id`, `tenant_id`, `member_id`, `contract_id`, `service_type text`, `resource_modality text nullable`, `balance int`, `earned_at`, `expires_at nullable`, `source` enum (`bundle`, `purchase`, `referral_reward`, `manual_grant`)
- `credit_consumptions` — `id`, `credit_id`, `appointment_id`, `consumed_at`, `amount int default 1`
- `referrals` — `id`, `tenant_id`, `referrer_member_id`, `code text unique` (por tenant), `reward_promotion_id`, `uses_count int default 0`, `max_uses int nullable`, `active`, `created_at`
- `referral_uses` — `id`, `referral_id`, `referred_member_id`, `contract_id`, `converted_at`, `reward_granted_at nullable`
- `cashback_ledger` (stretch) — `id`, `tenant_id`, `member_id`, `kind` enum (`earned`, `spent`), `amount_cents`, `source_invoice_id nullable`, `applied_to_invoice_id nullable`, `at`

**RLS:** tenant_id + scope por company quando aplicável (promoções podem ser por company em `distributed`).

## Eventos de domínio emitidos

- `promotion.applied` — `{ promotion_id, contract_id|invoice_id, discount_cents, at }`
- `promotion.expired` / `promotion.exhausted`
- `bundle.purchased` — `{ contract_id, bundle_plan_id, credits_granted: [...] }`
- `credit.granted` — `{ credit_id, member_id, service_type, balance }`
- `credit.consumed` — `{ credit_id, appointment_id, remaining_balance }`
- `credit.expired` — `{ credit_id, member_id, unused_balance }`
- `referral.created` / `referral.converted`
- `cashback.earned` / `cashback.redeemed` (stretch)

## Commit (checklist)

- [ ] Schema Drizzle: `promotions`, `promotion_uses`, `plan_items`, `appointment_credits`, `credit_consumptions`, `referrals`, `referral_uses`
- [ ] Migration: adicionar coluna `kind` em `plans`
- [ ] RLS + testes nos 5 cenários
- [ ] Zod schemas em `packages/types/ofertas.ts`
- [ ] Validador de promoção (`canApply(promotion, ctx)`) centralizado em `packages/db/ofertas/validate.ts`
- [ ] Consumo automático de crédito no `createAppointment` do Sprint 03 (se member tem crédito válido do `service_type` pedido)
- [ ] Server Actions de promoção, bundle, referral
- [ ] UI `/app/financeiro/{promocoes,pacotes,referrals}` com filtros e stats
- [ ] Widget "créditos ativos" em `/app/members/[id]` (slot novo `creditos`); registrar com `{ slot: 'creditos', requiredPermissions: ['member.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_active_credits }`
- [ ] Atualizar widget `financeiro` (Sprint 04) para mostrar promoções ativas no contrato
- [ ] Job noturno de expiração de créditos e promoções → emite eventos
- [ ] Seed: 3 promos + 2 bundles + 1 referral por tenant
- [ ] Testes unit: validador de promoção, cálculo de desconto, expiração de crédito
- [ ] Testes E2E: aplicar cupom, matricular em bundle, consumir crédito, referral completo
- [ ] Feature flag `ofertas_v1`
- [ ] ADR 0020 publicado

## Stretch

- [ ] Cashback ledger + regras de resgate
- [ ] Promoções segmentadas (só para quem está há >X meses sem pagar, só aniversariante do mês)
- [ ] Stackability configurável via UI (matriz de compatibilidade entre promoções)
- [ ] Crédito transferível entre members da mesma company (ex: família)

## Log

- **2026-05-13 — Faixa A entregue 🟢 (Sprint 05 a 25%).** Schemas + RLS + tests:
  - **`packages/db/src/schema/ofertas.ts`** — 7 tabelas + 1 enum:
    - `promotions` (id, tenant_id, code text, name, kind enum percent/fixed/trial_days, value int, valid_from/to, max_uses int, uses_count, applicable, min_amount_cents, stackable bool, active, archived_at). Unique `(tenant_id, code)`. Checks: `value >= 0`, `uses_count >= 0`, `max_uses NULL OR > 0`.
    - `promotion_uses` (audit append-only) — id, tenant_id, promotion_id, contract_id?, invoice_id?, member_id?, discount_cents, used_at, used_by_user_id.
    - `plan_items` — PK composta `(bundle_plan_id, idx)`, service_type text, quantity int, credit_validity_days?, notes. Checks: quantity > 0, validity NULL OR > 0.
    - `appointment_credits` — id, tenant_id, member_id, contract_id?, service_type, resource_modality?, balance int, initial_quantity int, source enum (bundle/purchase/referral_reward/manual_grant), earned_at, expires_at?. **Check critical: `balance <= initial_quantity`** + `balance >= 0` + `initial_quantity > 0`.
    - `credit_consumptions` (audit append-only) — id, tenant_id, credit_id, appointment_id?, consumed_at, amount, consumed_by_user_id.
    - `referrals` — id, tenant_id, referrer_member_id, code text, reward_promotion_id, uses_count, max_uses?, active. **Unique parcial `(tenant_id, referrer_member_id) WHERE active`** + `(tenant_id, code) UNIQUE`. Checks similares à promotions.
    - `referral_uses` (audit) — id, tenant_id, referral_id, referred_member_id, contract_id?, converted_at, reward_granted_at?. **Unique `(tenant_id, referred_member_id)`** — member novo só converte 1 referral.
  - **Enum novo**: `promotion_kind` (percent/fixed/trial_days), `credit_source` (bundle/purchase/referral_reward/manual_grant).
  - **`plans.kind`** — coluna nova text + check `IN ('plan', 'bundle')`. Default `'plan'`. Não usei pgEnum pra evitar dependency cycle Drizzle entre `financeiro.ts` ↔ `ofertas.ts`.
  - **migration `0010_freezing_mole_man.sql`** gerada via Drizzle (renomeada pra manter sequencial após cleanup).
  - **`packages/db/src/policies/0021_ofertas_rls.sql`** — 20 RLS policies + GRANTs:
    - `promotions` S/I/U sem D (soft via archivedAt)
    - `promotion_uses` S/I sem U/D (audit append-only)
    - `plan_items` CRUD (admin pode reorganizar bundle items)
    - `appointment_credits` S/I/U sem D (créditos expiram via UPDATE balance=0)
    - `credit_consumptions` S/I sem U/D (audit append-only)
    - `referrals` S/I/U sem D
    - `referral_uses` S/I/U (status update permitido após conversão)
    - GRANTs explícitos pra `logifit_app`
  - **`packages/db/tests/ofertas-rls.test.ts`** — **10 Vitest integration tests**:
    - RLS isolation per-tenant (Rede vê promo dela; Franquia não)
    - Check `value >= 0` em promotions → 23514
    - `(tenant, code)` unique em promotions; mesma code em outro tenant coexiste
    - `appointment_credits.balance > initial_quantity` → 23514
    - balance < 0 → 23514
    - balance == initial_quantity OK + UPDATE decrementa pra 3
    - referrals: 2 ativos por (tenant, member) → 23505 (unique partial)
    - referrals.code unique por tenant
    - plans.kind = 'plan' e 'bundle' aceitos
    - plans.kind = 'invalid' → 23514

  **Validações:**
  - typecheck 11/11 ✅
  - `db:rls-check` 3 regras OK em **49 tabelas** (era 42, +7 ofertas)
  - **115 Vitest tests verdes** (era 105 — +10 ofertas-rls)

  **Sprint 05 a 25%.** Faixas restantes:
  - **Faixa B** — Server Actions (createPromotion + applyPromotion + createBundle + subscribeBundle + consumeCredit + createReferralCode + applyReferral) + validador `canApply(promotion, ctx)` + integração com `createAppointment` pra consumir crédito automaticamente
  - **Faixa C** — UI `/app/financeiro/promocoes` + `/pacotes` + `/referrals` + widget créditos em `/app/members/[id]`
  - **Faixa D** — Job noturno expiração créditos + ADR 0020 publicado + Seed 3 promos + 2 bundles + 1 referral por tenant

## Definition of Done

- [ ] Feature flag `ofertas_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 05 → `done`, item #10 → `done`
- [ ] ADR 0020 publicado
- [ ] Zero violação de regras

## Retro

- —
