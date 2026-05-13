/**
 * Ofertas comerciais — Sprint 05 Faixa A (ADR 0020 esperado).
 *
 * 7 tabelas + 1 nova coluna em `plans`:
 *   - `plans.kind enum ('plan','bundle')` — bundle é um plan composto de plan_items
 *   - `promotions` (cupons) + `promotion_uses` (audit aplicação)
 *   - `plan_items` (composição bundle: services + créditos)
 *   - `appointment_credits` (saldo) + `credit_consumptions` (audit consumo)
 *   - `referrals` (códigos) + `referral_uses` (conversões)
 *
 * **Modelo**: cupom em `promotions`; aplicação grava `promotion_uses` com
 * desconto efetivo. Bundle é `plans.kind='bundle'` + `plan_items[]`. Member
 * matriculado em bundle ganha `appointment_credits` com saldo (`balance`).
 * Cada uso de crédito grava `credit_consumptions` linkado ao `appointment`.
 * Referral é código único por member; conversão grava `referral_uses` e
 * dispara desconto na 1ª invoice via `promotion_uses`.
 *
 * Histórico preservado — nada deleta, tudo cancela ou expira.
 *
 * **RLS**: tenant_id + scope per-company quando aplicável.
 *
 * @volume_estimate_yearly: 500000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { contracts, invoices, plans } from './financeiro'
import { members } from './members'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const promotionKindEnum = pgEnum('promotion_kind', [
  'percent', // value = pct 0-100 (multiplicado por 100, ex: 1250 = 12.50%)
  'fixed', // value = cents (desconto fixo em centavos)
  'trial_days', // value = dias (concede N dias trial pago)
])

export const creditSourceEnum = pgEnum('credit_source', [
  'bundle',
  'purchase',
  'referral_reward',
  'manual_grant',
])

// ─── promotions ──────────────────────────────────────────────────────────
/**
 * Cupons/promoções.
 *
 * `code` UNIQUE por tenant (case-insensitive — Sprint 05+ Faixa B normaliza
 * pra UPPER). `applicable_plan_ids` array vazio = aplica em qualquer plan.
 * `min_amount_cents` previne abuso ("cupom 50% só pra invoice > R$ 100").
 *
 * `stackable=false` (default): aplicar cupom em invoice/contract sem outra
 * promotion ativa. `stackable=true`: pode coexistir com outros.
 */
export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: promotionKindEnum('kind').notNull(),
    value: integer('value').notNull(), // semantics dependente do kind
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    maxUses: integer('max_uses'), // null = ilimitado
    usesCount: integer('uses_count').notNull().default(0),
    minAmountCents: integer('min_amount_cents'),
    stackable: boolean('stackable').notNull().default(false),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('promotions_tenant_code_uq').on(t.tenantId, t.code),
    index('promotions_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`active = true AND archived_at IS NULL`),
    check('promotions_value_non_negative', sql`${t.value} >= 0`),
    check('promotions_uses_non_negative', sql`${t.usesCount} >= 0`),
    check(
      'promotions_max_uses_valid',
      sql`${t.maxUses} IS NULL OR ${t.maxUses} > 0`,
    ),
  ],
)

// ─── promotion_uses (audit) ──────────────────────────────────────────────
export const promotionUses = pgTable(
  'promotion_uses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    discountCents: integer('discount_cents').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
    usedByUserId: uuid('used_by_user_id').references(() => users.id),
  },
  (t) => [
    index('promotion_uses_tenant_promo_idx').on(t.tenantId, t.promotionId, t.usedAt),
    index('promotion_uses_contract_idx').on(t.contractId),
    index('promotion_uses_invoice_idx').on(t.invoiceId),
    check('promotion_uses_discount_positive', sql`${t.discountCents} >= 0`),
  ],
)

// ─── plan_items (composição de bundle) ───────────────────────────────────
/**
 * Composição de bundle. `bundle_plan_id` aponta pro plan com `kind='bundle'`.
 *
 * Cada linha define um "serviço/benefício incluído". `service_type` é text
 * livre por enquanto (Sprint 06+ vira FK pra `services` ADR 0068). `quantity`
 * é o crédito inicial gerado pra cada cycle do bundle.
 *
 * Sem PK uuid — PK composta `(bundle_plan_id, idx)` mantém ordem.
 */
export const planItems = pgTable(
  'plan_items',
  {
    tenantId: uuid('tenant_id').notNull(),
    bundlePlanId: uuid('bundle_plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // ordem no bundle
    serviceType: text('service_type').notNull(), // 'personal_training' | 'nutri_consulta' | ...
    quantity: integer('quantity').notNull(),
    creditValidityDays: integer('credit_validity_days'), // null = sem expiração
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plan_items_pk').on(t.bundlePlanId, t.idx),
    index('plan_items_tenant_idx').on(t.tenantId, t.bundlePlanId),
    check('plan_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'plan_items_validity_days_valid',
      sql`${t.creditValidityDays} IS NULL OR ${t.creditValidityDays} > 0`,
    ),
  ],
)

// ─── appointment_credits ─────────────────────────────────────────────────
/**
 * Saldo de créditos de um member pra um service_type específico.
 *
 * Crédito tem origem (`source`: bundle/purchase/referral_reward/manual_grant)
 * + validade (`expires_at`). Sprint 06+ adiciona partial index `WHERE balance > 0`.
 *
 * **Consumo via createAppointment** (Sprint 03 atualiza Faixa B do Sprint 05):
 * SELECT credit ativo + balance > 0 → INSERT credit_consumption + UPDATE
 * balance -= amount em transação.
 *
 * **Expiração via cron** (Sprint 05 Faixa C): job marca expirados como
 * `balance = 0` + emite `credit.expired` event.
 */
export const appointmentCredits = pgTable(
  'appointment_credits',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    serviceType: text('service_type').notNull(),
    resourceModality: text('resource_modality'), // 'musculacao' | 'coletiva' | etc — null = qualquer
    balance: integer('balance').notNull(),
    initialQuantity: integer('initial_quantity').notNull(),
    source: creditSourceEnum('source').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credits_tenant_member_idx').on(t.tenantId, t.memberId),
    index('credits_member_service_idx').on(t.memberId, t.serviceType),
    // `WHERE balance > 0` apenas — Postgres rejeita `now()` em index predicate
    // (functions devem ser IMMUTABLE). Filtro de expires_at fica no SELECT.
    index('credits_active_idx')
      .on(t.tenantId, t.memberId, t.serviceType)
      .where(sql`balance > 0`),
    check('credits_balance_non_negative', sql`${t.balance} >= 0`),
    check('credits_initial_positive', sql`${t.initialQuantity} > 0`),
    check(
      'credits_balance_le_initial',
      sql`${t.balance} <= ${t.initialQuantity}`,
    ),
  ],
)

// ─── credit_consumptions (audit) ─────────────────────────────────────────
export const creditConsumptions = pgTable(
  'credit_consumptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    creditId: uuid('credit_id')
      .notNull()
      .references(() => appointmentCredits.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id'), // FK pra appointments — Sprint 05 Faixa B integra
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
    amount: integer('amount').notNull().default(1),
    consumedByUserId: uuid('consumed_by_user_id').references(() => users.id),
  },
  (t) => [
    index('credit_consumptions_tenant_credit_idx').on(t.tenantId, t.creditId, t.consumedAt),
    index('credit_consumptions_appointment_idx').on(t.appointmentId),
    check('credit_consumptions_amount_positive', sql`${t.amount} > 0`),
  ],
)

// ─── referrals ────────────────────────────────────────────────────────────
/**
 * Códigos de referral. 1 por member ativo.
 *
 * `reward_promotion_id` aponta pra `promotions` que vai ser aplicado quando
 * código for usado em nova matrícula. `max_uses` limita conversões.
 */
export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    referrerMemberId: uuid('referrer_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    rewardPromotionId: uuid('reward_promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'restrict' }),
    usesCount: integer('uses_count').notNull().default(0),
    maxUses: integer('max_uses'), // null = ilimitado
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referrals_tenant_code_uq').on(t.tenantId, t.code),
    uniqueIndex('referrals_tenant_member_uq')
      .on(t.tenantId, t.referrerMemberId)
      .where(sql`active = true`),
    index('referrals_tenant_active_idx').on(t.tenantId).where(sql`active = true`),
    check('referrals_uses_non_negative', sql`${t.usesCount} >= 0`),
    check(
      'referrals_max_uses_valid',
      sql`${t.maxUses} IS NULL OR ${t.maxUses} > 0`,
    ),
  ],
)

// ─── referral_uses (audit) ────────────────────────────────────────────────
export const referralUses = pgTable(
  'referral_uses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    referralId: uuid('referral_id')
      .notNull()
      .references(() => referrals.id, { onDelete: 'restrict' }),
    referredMemberId: uuid('referred_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
    convertedAt: timestamp('converted_at', { withTimezone: true }).notNull().defaultNow(),
    rewardGrantedAt: timestamp('reward_granted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('referral_uses_referred_uq').on(t.tenantId, t.referredMemberId), // 1 referral por member novo
    index('referral_uses_tenant_referral_idx').on(t.tenantId, t.referralId),
  ],
)
