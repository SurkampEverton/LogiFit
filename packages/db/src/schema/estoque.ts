/**
 * Estoque + POS + Inventário — Sprint 24 Faixa A (ADR 0087 esperado).
 *
 * 4 tabelas:
 *   - stock_items — catálogo SKU+nome+categoria+custo+preço+min_stock
 *   - stock_movements — entries+exits append-only (regra 5; nunca DELETE)
 *   - stock_inventories — contagem física agregada
 *   - stock_inventory_entries — item por inventário com diferença system_qty × physical_qty
 *
 * **ADR 0087 esperado** — método de custo configurável por tenant
 * (PEPS = FIFO / custo médio) + saldo calculado por soma de movimentações
 * (não denormalizado — evita divergência).
 *
 * **Quantity convenção:** sempre positivo; `kind` define sinal (entry_* soma,
 * exit_* subtrai). View `stock_balances` calcula saldo via SUM.
 *
 * **Particionamento `stock_movements`** (regra 34 + ADR 0072):
 *   - 1k tenants × 50 SKUs × 4 movimentações/mês × 12 = 2.4M+ linhas/ano
 *   - PARTITION BY RANGE (at) trimestral via migration manual (sprint 24b)
 *   - Retenção fiscal 5a hot (estoque é base contábil)
 *
 * **Append-only** — UPDATE permitido só pra `notes` (typo); DELETE proibido
 * pela RLS Sprint 24b com permission gate. Ajuste vira movimento novo
 * `entry_adjustment` ou `exit_adjustment` (regra 5).
 *
 * @volume_estimate_yearly: 2400000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { invoices } from './financeiro'
import { companies, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const stockMovementKindEnum = pgEnum('stock_movement_kind', [
  'entry_purchase', // compra recebida (NF-e ou manual)
  'entry_adjustment', // ajuste pra mais (correção de inventário)
  'entry_return_from_customer', // devolução de venda (cliente devolveu)
  'exit_consumption', // gasto em atendimento
  'exit_sale', // venda no POS
  'exit_loss', // perda/quebra/validade
  'exit_adjustment', // ajuste pra menos (correção de inventário)
  'exit_return_to_supplier', // devolução ao fornecedor
])

export const stockInventoryStatusEnum = pgEnum('stock_inventory_status', [
  'draft', // contagem em andamento
  'finalized', // gerou ajustes em stock_movements
])

export const stockCostMethodEnum = pgEnum('stock_cost_method', [
  'peps', // FIFO: primeiro a entrar, primeiro a sair
  'custo_medio', // média ponderada
])

// ─── stock_items ────────────────────────────────────────────────────────

export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    /** Unidade de medida (un / kg / g / ml / l / cx) */
    unit: text('unit').notNull().default('un'),
    /** Custo médio atualizado (para custo_medio); custo do último lote (PEPS calcula sob demanda) */
    costCents: bigint('cost_cents', { mode: 'number' }).notNull().default(0),
    /** Preço de venda quando is_resale=true (POS usa) */
    salePriceCents: bigint('sale_price_cents', { mode: 'number' }),
    /** Estoque mínimo — dispara alerta low_stock */
    minStock: numeric('min_stock', { precision: 12, scale: 3 }).notNull().default('0'),
    /** True = item de revenda (POS); false = consumo interno só */
    isResale: boolean('is_resale').notNull().default(false),
    /** Código de barras opcional (Sprint 24b leitor) */
    barcode: text('barcode'),
    /** NCM 8 dígitos — obrigatório pra emissão NF-e/NFC-e de item de revenda (ADR 0101) */
    ncm: text('ncm'),
    /** CEST — substituição tributária, quando aplicável ao NCM */
    cestCode: text('cest_code'),
    /** Método de custo aplicável (default = tenant setting; Sprint 24b lê de tenant_settings) */
    costMethod: stockCostMethodEnum('cost_method').notNull().default('custo_medio'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('si_tenant_company_sku_uq').on(t.tenantId, t.companyId, t.sku),
    index('si_tenant_company_active_idx').on(t.tenantId, t.companyId).where(sql`active = true`),
    index('si_tenant_category_idx').on(t.tenantId, t.category),
    index('si_resale_idx')
      .on(t.tenantId, t.isResale)
      .where(sql`active = true AND is_resale = true`),
    check('si_min_stock_positive', sql`min_stock >= 0`),
    check('si_cost_non_negative', sql`cost_cents >= 0`),
  ],
)

// ─── stock_movements ────────────────────────────────────────────────────

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    kind: stockMovementKindEnum('kind').notNull(),
    /** Sempre positivo; kind define sinal */
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    /** Custo unitário no momento (entry_purchase obriga; outros opcionais) */
    unitCostCents: bigint('unit_cost_cents', { mode: 'number' }),
    /** Documento de referência (NF-e number, invoice id, etc) */
    referenceDoc: text('reference_doc'),
    /** Vínculos opcionais para auditoria */
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, {
      onDelete: 'set null',
    }),
    /** Movimento gerado por inventário tem inventory_id */
    inventoryId: uuid('inventory_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Quando o movimento aconteceu (default now; pode ser retroativo) */
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sm_tenant_item_at_idx').on(t.tenantId, t.itemId, t.at),
    index('sm_tenant_kind_idx').on(t.tenantId, t.kind, t.at),
    index('sm_appointment_idx').on(t.appointmentId).where(sql`appointment_id IS NOT NULL`),
    index('sm_invoice_idx').on(t.invoiceId).where(sql`invoice_id IS NOT NULL`),
    check('sm_quantity_positive', sql`quantity > 0`),
    check(
      'sm_unit_cost_consistent',
      sql`(kind != 'entry_purchase' OR unit_cost_cents IS NOT NULL)`,
    ),
  ],
)

// ─── stock_inventories ──────────────────────────────────────────────────

export const stockInventories = pgTable(
  'stock_inventories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    countedAt: timestamp('counted_at', { withTimezone: true }).notNull().defaultNow(),
    countedByUserId: uuid('counted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: stockInventoryStatusEnum('status').notNull().default('draft'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    finalizedByUserId: uuid('finalized_by_user_id').references(() => users.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sinv_tenant_company_idx').on(t.tenantId, t.companyId, t.countedAt),
    index('sinv_status_idx').on(t.tenantId, t.status),
  ],
)

// ─── stock_inventory_entries ────────────────────────────────────────────

export const stockInventoryEntries = pgTable(
  'stock_inventory_entries',
  {
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => stockInventories.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    systemQty: numeric('system_qty', { precision: 12, scale: 3 }).notNull(),
    physicalQty: numeric('physical_qty', { precision: 12, scale: 3 }).notNull(),
    /** Diferença pra rastrear ajuste (positiva = sobra; negativa = falta) */
    difference: numeric('difference', { precision: 12, scale: 3 }).notNull(),
    notes: text('notes'),
  },
  (t) => [
    primaryKey({ columns: [t.inventoryId, t.itemId] }),
    check('sie_qty_non_negative', sql`physical_qty >= 0 AND system_qty >= 0`),
    check('sie_difference_consistent', sql`difference = physical_qty - system_qty`),
  ],
)

void integer
