/**
 * Vendas POS (balcão/revenda) — Sprint 24b (ADR 0101; débito de schema do Sprint 24).
 *
 * 3 tabelas:
 *   - sales — cabeçalho: company emitente + comprador opcional + totais + operador
 *   - sale_items — itens com SNAPSHOT fiscal (sku/descrição/NCM/CEST congelados
 *     no momento da venda — auditoria da nota emitida sobrevive a edição do estoque)
 *   - sale_payments — formas de pagamento (grupo obrigatório na NFC-e modelo 65)
 *
 * **Fonte fiscal:** `fiscal_emissions.source_kind='sale'` + `source_id=sales.id`
 * (emitNfeProductFromSale / emitNfceFromSale — ADR 0059).
 *
 * **Consistência cross-row** (total = Σ items − desconto; Σ payments = total)
 * é enforced na Server Action — CHECK de tabela não cruza rows.
 *
 * **Cancelamento é soft** (`status='cancelled'` + cancelled_at + reason) —
 * venda com nota emitida exige cancelamento fiscal antes (SA valida).
 *
 * @volume_estimate_yearly: 200000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { stockItems } from './estoque'
import { companies, units, users } from './identity'
import { members } from './members'
import { persons } from './persons'

export const saleStatusEnum = pgEnum('sale_status', ['completed', 'cancelled'])

/**
 * Método semântico — código SEFAZ (01 dinheiro / 17 PIX / 03 crédito /
 * 04 débito / 99 outro) é mapeado na borda da emissão, nunca armazenado.
 */
export const salePaymentMethodEnum = pgEnum('sale_payment_method', [
  'dinheiro',
  'pix',
  'credito',
  'debito',
  'outro',
])

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    /** Comprador member (aluno/paciente) — null em venda anônima de balcão */
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    /** Comprador PF/PJ identificado não-member (NF-e exige destinatário) */
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'set null' }),
    status: saleStatusEnum('status').notNull().default('completed'),
    /** Total líquido em centavos (Σ items − desconto) */
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull().default(0),
    /** FK users.id (migration 0060) — NUNCA auth_user.id; SET NULL preserva a venda */
    soldByUserId: uuid('sold_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sales_tenant_sold_at_idx').on(t.tenantId, t.soldAt),
    index('sales_tenant_company_idx').on(t.tenantId, t.companyId),
    index('sales_member_idx').on(t.tenantId, t.memberId).where(sql`member_id IS NOT NULL`),
    check('sales_total_non_negative', sql`total_cents >= 0`),
    check('sales_discount_non_negative', sql`discount_cents >= 0`),
    // Comprador: member OU person OU anônimo — nunca os dois
    check('sales_buyer_exclusive', sql`NOT (member_id IS NOT NULL AND person_id IS NOT NULL)`),
    check('sales_cancelled_consistency', sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`),
  ],
)

export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    /** Snapshots fiscais no momento da venda (ADR 0101) */
    sku: text('sku').notNull(),
    description: text('description').notNull(),
    ncm: text('ncm'),
    cestCode: text('cest_code'),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sale_items_sale_idx').on(t.saleId),
    index('sale_items_tenant_stock_item_idx').on(t.tenantId, t.stockItemId),
    check('sale_items_quantity_positive', sql`quantity > 0`),
    check('sale_items_unit_non_negative', sql`unit_cents >= 0`),
    check('sale_items_total_non_negative', sql`total_cents >= 0`),
  ],
)

export const salePayments = pgTable(
  'sale_payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: salePaymentMethodEnum('method').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sale_payments_sale_idx').on(t.saleId),
    check('sale_payments_amount_positive', sql`amount_cents > 0`),
  ],
)
