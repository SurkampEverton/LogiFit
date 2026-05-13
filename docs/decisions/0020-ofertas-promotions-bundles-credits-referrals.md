---
slug: ofertas-promotions-bundles-credits-referrals
status: accepted
date: 2026-05-13
---

# ADR 0020 — Ofertas: promotions + bundles + credits + referrals como entidades independentes

## Contexto

Sprint 05 entrega a camada comercial: cupons, pacotes (bundles), créditos
consumíveis e indicações premiadas. Existem dois caminhos arquiteturais:

### A. Tudo embutido em `plans`/`contracts`

`plans.discount_pct` + `contracts.referral_code` + `contracts.bonus_credits int`.
Schema simples mas:

- ❌ **Histórico evaporado**: aplicar cupom B sobre A perde A
- ❌ **Audit ruim**: quem aplicou, quando, por quê? Colunas separadas em `contracts`
- ❌ **Regras de stackability não-explícitas**: lógica espalhada em Server Actions
- ❌ **Bundle = plan com flags** vira hack — `plans.bundle_items jsonb` = sem RLS, sem unique, sem check

### B. 7 tabelas independentes (escolhido)

`promotions` + `promotion_uses` (audit) + `plan_items` (composição bundle) +
`appointment_credits` + `credit_consumptions` (audit) + `referrals` +
`referral_uses` (audit). Cada entidade tem ciclo de vida próprio + RLS isolada.

## Decisão

Adotar 7 tabelas:

```
promotions ─── promotion_uses (audit aplicação)
plans (kind='bundle') ─── plan_items (composição)
                         ↓
                    appointment_credits (saldo) ─── credit_consumptions (audit)
referrals ─── referral_uses (conversão)
            ↓
       promotions (reward)
```

### Por que `promotions` separada de `plans`

- **Cupom não é plano**: cupom é regra de desconto aplicável em qualquer
  plano/invoice. Plan é catálogo + preço.
- **Vigência independente**: cupom pode valer 7 dias; plan vale enquanto ativo.
- **Stackability explícita**: `promotions.stackable bool` define se outras
  promotions podem coexistir. Sem flag em `plans` evita sujeira.
- **Audit perfeito**: `promotion_uses` registra cada aplicação com `discount_cents`
  + `applied_by user_id` + `used_at`.

### Por que `appointment_credits` separada de `contracts`

- **Crédito não é contrato**: contrato é vínculo recorrente; crédito é saldo
  consumível discreto.
- **N créditos por contract**: bundle gera 1 crédito por `plan_item`. Member com
  3 bundles ativos = 3+ rows de crédito.
- **Múltiplas origens (`source` enum)**: bundle, purchase avulsa, referral
  reward, manual grant. Cada origem tem regras de expiração diferentes.
- **Check constraint `balance <= initial_quantity` + `balance >= 0`** garante
  integridade no banco (defesa em profundidade contra bug consumeCredit).

### Por que `referrals` separada (não jsonb em `members`)

- **1 código ativo por member** com unique partial `WHERE active = true` —
  schema relacional resolve sem trigger custom.
- **`referrals.reward_promotion_id`** liga ao desconto que o convidado ganha,
  reutilizando infra de promoções. DRY.
- **Audit completo**: `referral_uses` lista todos os indicados + status de
  reward concedido (manual ou automático).

### `plans.kind` text + check vs. pgEnum

`plan_kind` (`'plan' | 'bundle'`) **NÃO** declarado como pgEnum em
`ofertas.ts` pra evitar dependency cycle no Drizzle (`financeiro.ts` ↔
`ofertas.ts` se ambos exportarem enums um pro outro). Solução: text + check
`IN ('plan', 'bundle')` na tabela `plans` no `financeiro.ts`.

Trade-off: perde tipagem enum em queries Drizzle; ganha em ausência de ciclo.
Sprint 06+ pode migrar pra enum se virar pain de DX.

## `canApply(promotion, ctx)` validator

Centralizado em `applyPromotion` Server Action. Checks:

1. `active = true AND archived_at IS NULL`
2. `valid_from <= now AND (valid_to IS NULL OR valid_to >= now)`
3. `max_uses IS NULL OR uses_count < max_uses`
4. `min_amount_cents IS NULL OR target.amount_cents >= min_amount_cents`
5. Invoice target em `pending` status (não aplica em paid/cancelled)

Cálculo de desconto:

- `kind='percent'`: `discount = (amount * value) / 10000` (value é pct * 100)
- `kind='fixed'`: `discount = min(value, amount - 1)` (deixa pelo menos R$0.01)
- `kind='trial_days'`: `discount = 0` (afeta dates, não amount — Sprint 06+)

## Race conditions

**Aplicar cupom 2× simultâneo** com `max_uses=1`:

1. Tx A: SELECT promo → uses_count=0
2. Tx B: SELECT promo → uses_count=0
3. Tx A: UPDATE SET uses_count = uses_count + 1 WHERE uses_count < max_uses → OK (1 row)
4. Tx B: UPDATE SET uses_count = uses_count + 1 WHERE uses_count < max_uses → 0 rows

Pattern `WHERE uses_count < max_uses` é optimistic locking. Tx B detecta 0 rows
returned e lança `CONFLICT: cupom esgotado (race)`. Sem advisory lock.

**Consumir crédito 2× simultâneo**:

```sql
UPDATE appointment_credits
SET balance = balance - 1
WHERE id = $1 AND balance >= 1
RETURNING id
```

Se 0 rows: race detectado, lança CONFLICT. Defesa adicional via check constraint
`balance >= 0`.

## Consequências

### Positivas

- **Histórico fiscal preservado**: cancelar promoção não afeta promotion_uses
  já aplicadas. Audit completo.
- **Composição flexível**: bundle pode ter N tipos de serviço diferentes;
  appointment_credits separa cada tipo (personal vs. nutri vs. avaliação).
- **Defesa em profundidade**: check constraints + unique parciais + optimistic
  locking cobrem 95% de race conditions sem locks pessimistas.
- **Reuso entre features**: referral usa promotions como reward → DRY.
- **Soft-delete pattern**: promotions/referrals desativam (active=false +
  archivedAt), créditos expiram (balance=0). Nada deleta.

### Negativas

- **7 tabelas pra modelar conceito vendido como "promoções"** — onboarding time
  precisa entender pipeline.
- **JOINs**: widget de "Créditos ativos" em member faz 1 query simples (RLS
  scoped). Widget "Promoções aplicadas no contrato" faz JOIN promotions ←
  promotion_uses. Mitigado por indexes apropriados.
- **`plans.kind` text + check** perde DX de enum; aceito pra evitar dependency
  cycle Drizzle.

## Alternativas consideradas

- **Stripe-style `coupons` collection** com JSON config: rejeitado por sem RLS
  granular + audit pobre.
- **`bundle_credits` jsonb em `contracts`**: rejeitado por sem unique
  constraint cross-tenant + nenhum check constraint em saldo.
- **`promotion_layers` (separar regra de desconto)** — over-engineering; uses
  count é simples o suficiente.

## Referências

- [Sprint 05 — Ofertas comerciais](../sprints/05-geral-ofertas-comerciais.md)
- [ADR 0013 — Plano + Contrato + Cobrança 3 entidades](0013-plano-contrato-cobranca-entidades-separadas.md)
- [ADR 0068 — Catálogo de serviços + preços contextuais](0068-catalogo-servicos-precos-contextuais-link-financeiro.md)
- [Regra 5 — audit_log append-only](../rules.md#5)
