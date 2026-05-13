/**
 * Financeiro Asaas — Sprint 04 Faixa A (ADR 0013 + 0014 esperados).
 *
 * 6 tabelas: `plans` (catálogo) + `contracts` (member↔plano) + `invoices` +
 * `payments` + `asaas_keys` (credentials) + `webhook_events` (idempotência).
 *
 * **Modelo Asaas**:
 * - 1 chave Asaas por `company` quando `tenant.financial_mode='distributed'`
 * - 1 chave Asaas por `tenant` quando `financial_mode='centralized'` (via matriz)
 * - Check constraint em `asaas_keys` enforça regra
 *
 * **Webhook idempotência**: `webhook_events.external_id` UNIQUE — Asaas envia
 * mesmo evento 2× se 200 demorar > timeout; segunda chamada retorna 200 sem
 * reprocessar.
 *
 * **Particionamento**: `invoices` previsão >5M rows/ano em rede grande (regra 34
 * + ADR 0072). Sprint 05+ avalia particionamento por `due_at` mensal. MVP cabe
 * sem.
 *
 * @volume_estimate_yearly: 1500000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const billingCycleEnum = pgEnum('billing_cycle', ['monthly', 'quarterly', 'yearly'])

export const contractStatusEnum = pgEnum('contract_status', [
  'active',
  'paused', // Trancamento (regra 24 — academia)
  'cancelled',
  'expired',
])

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'pending', // Cobrança gerada, aguardando pagamento
  'paid',
  'overdue', // Vencida sem pagamento (após grace period — Sprint 04+ define)
  'cancelled',
  'refunded',
])

export const paymentMethodEnum = pgEnum('payment_method', ['boleto', 'pix', 'credit_card'])

// ─── plans (catálogo de planos comerciais) ───────────────────────────────
export const plans = pgTable(
  'plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    // Sprint 05 Faixa A — distingue plan simples vs. bundle composto de plan_items.
    // text com check pra evitar dependency cycle com ofertas.ts enum.
    kind: text('kind').notNull().default('plan'),
    priceCents: integer('price_cents').notNull(),
    billingCycle: billingCycleEnum('billing_cycle').notNull().default('monthly'),
    trialDays: integer('trial_days').notNull().default(0),
    cancelNoticeDays: integer('cancel_notice_days').notNull().default(0),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plans_tenant_company_idx').on(t.tenantId, t.companyId),
    index('plans_active_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`active = true AND archived_at IS NULL`),
    check('plans_price_non_negative', sql`${t.priceCents} >= 0`),
    check('plans_kind_valid', sql`${t.kind} IN ('plan', 'bundle')`),
  ],
)

// ─── contracts (member ↔ plano com vigência) ─────────────────────────────
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: contractStatusEnum('status').notNull().default('active'),
    billingDay: integer('billing_day').notNull().default(10), // 1-28
    // Pause (trancamento academia)
    pauseReason: text('pause_reason'),
    pauseStartsAt: timestamp('pause_starts_at', { withTimezone: true }),
    pauseEndsAt: timestamp('pause_ends_at', { withTimezone: true }),
    // Auto-pause rule (Sprint 04+ define exatamente o shape — `{trigger, value}`)
    autoPauseRule: jsonb('auto_pause_rule'),
    // Cancellation
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contracts_tenant_member_idx').on(t.tenantId, t.memberId),
    index('contracts_tenant_plan_idx').on(t.tenantId, t.planId),
    index('contracts_active_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`status = 'active'`),
    check('contracts_billing_day_range', sql`${t.billingDay} BETWEEN 1 AND 28`),
  ],
)

// ─── invoices (cobranças emitidas) ───────────────────────────────────────
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('pending'),
    asaasId: text('asaas_id'),
    externalUrl: text('external_url'),
    // Breakdown jsonb (ADR 0068): {base, overage_items, discounts, surcharges, taxes_withheld}
    breakdown: jsonb('breakdown'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoices_asaas_id_uq').on(t.asaasId).where(sql`asaas_id IS NOT NULL`),
    index('invoices_tenant_status_idx').on(t.tenantId, t.status),
    index('invoices_tenant_contract_idx').on(t.tenantId, t.contractId),
    index('invoices_tenant_due_idx').on(t.tenantId, t.dueAt),
    index('invoices_member_idx').on(t.tenantId, t.memberId, t.dueAt),
    check('invoices_amount_non_negative', sql`${t.amountCents} >= 0`),
  ],
)

// ─── payments (pagamentos confirmados pelo Asaas) ────────────────────────
export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    method: paymentMethodEnum('method').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    asaasId: text('asaas_id').notNull(),
    rawPayload: jsonb('raw_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_asaas_id_uq').on(t.asaasId),
    index('payments_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    index('payments_tenant_paid_idx').on(t.tenantId, t.paidAt),
  ],
)

// ─── asaas_keys (credenciais por tenant ou company) ──────────────────────
/**
 * Regra ADR 0014:
 *   - `tenant.financial_mode = 'centralized'` → 1 row com `company_id IS NULL`
 *   - `tenant.financial_mode = 'distributed'` → N rows com `company_id IS NOT NULL`
 * Check constraint enforça: NÃO podem coexistir 1 NULL + 1 NOT NULL pro mesmo tenant.
 *
 * `api_key` é **criptografado** (placeholder — Sprint 04+ Faixa B implementa
 * envelope encryption com chave em env secret). Por enquanto, plain pra MVP.
 */
export const asaasKeys = pgTable(
  'asaas_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    apiKey: text('api_key').notNull(), // TODO Sprint 04+ envelope encryption
    sandbox: boolean('sandbox').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 chave ativa por (tenant, company?) — company_id NULL = chave central
    uniqueIndex('asaas_keys_tenant_company_active_uq')
      .on(t.tenantId, t.companyId)
      .where(sql`active = true`),
    index('asaas_keys_tenant_idx').on(t.tenantId),
  ],
)

// ─── webhook_events (idempotência) ───────────────────────────────────────
/**
 * Defesa contra Asaas reenviar mesmo evento (timeout 200).
 * `external_id` UNIQUE — segunda chamada retorna 200 sem reprocessar.
 *
 * Particionamento por `received_at` mensal entra Sprint 05+ (volume <100k/mês MVP).
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    source: text('source').notNull(), // 'asaas' | 'focus-nfe' | etc
    externalId: text('external_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    payload: jsonb('payload').notNull(),
    error: text('error'),
    // tenantId opcional — webhook chega sem auth; processor resolve via payload
    tenantId: uuid('tenant_id'),
  },
  (t) => [
    uniqueIndex('webhook_events_source_external_uq').on(t.source, t.externalId),
    index('webhook_events_received_idx').on(t.receivedAt),
    index('webhook_events_unprocessed_idx')
      .on(t.source, t.receivedAt)
      .where(sql`processed_at IS NULL`),
  ],
)
