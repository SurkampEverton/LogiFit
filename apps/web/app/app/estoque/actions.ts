'use server'

/**
 * Server Actions Estoque — Sprint 24 Faixa B.2 (ADR 0087 esperado).
 *
 * MVP:
 *   - createStockItem / updateStockItem / archiveStockItem
 *   - registerEntry (compra/ajuste; calcula novo custo médio se cost_method=custo_medio)
 *   - registerExit (consumo/perda/ajuste; emite low_stock_alert quando cruzar)
 *   - sellAtPos (cria invoice Sprint 04 + movimentação exit_sale)
 *   - startInventory + addInventoryCount + finalizeInventory (gera ajustes)
 *   - getItemBalance (utilitário read-only)
 *   - listLowStockItems (alertas pendentes)
 *
 * **Append-only** — Server Actions de stock_movements só fazem INSERT.
 *
 * **Cost method tenant default** — Sprint 24b adiciona `tenant_settings.cost_method`.
 * MVP usa `stock_items.cost_method` default 'custo_medio'.
 */

import {
  calculateAverageCostCents,
  calculateBalance,
  detectLowStockCrossing,
  type Movement,
} from '@repo/db/estoque'
import { db } from '@repo/db/client'
import {
  members,
  stockInventories,
  stockInventoryEntries,
  stockItems,
  stockMovements,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateItemInputSchema = z.object({
  companyId: z.string().uuid(),
  sku: z.string().min(1).max(50),
  name: z.string().min(2).max(200),
  category: z.string().max(80).optional().nullable(),
  unit: z.string().min(1).max(10).default('un'),
  costCents: z.number().int().min(0).default(0),
  salePriceCents: z.number().int().min(0).optional().nullable(),
  minStock: z.number().min(0).default(0),
  isResale: z.boolean().default(false),
  barcode: z.string().max(80).optional().nullable(),
  costMethod: z.enum(['peps', 'custo_medio']).default('custo_medio'),
})

const UpdateItemInputSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  category: z.string().max(80).optional().nullable(),
  salePriceCents: z.number().int().min(0).optional().nullable(),
  minStock: z.number().min(0).optional(),
  costMethod: z.enum(['peps', 'custo_medio']).optional(),
  isResale: z.boolean().optional(),
})

const RegisterEntryInputSchema = z.object({
  itemId: z.string().uuid(),
  kind: z.enum(['entry_purchase', 'entry_adjustment', 'entry_return_from_customer']),
  quantity: z.number().positive(),
  unitCostCents: z.number().int().min(0).optional().nullable(),
  referenceDoc: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

const RegisterExitInputSchema = z.object({
  itemId: z.string().uuid(),
  kind: z.enum([
    'exit_consumption',
    'exit_loss',
    'exit_adjustment',
    'exit_return_to_supplier',
  ]),
  quantity: z.number().positive(),
  appointmentId: z.string().uuid().optional().nullable(),
  referenceDoc: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

const SellAtPosInputSchema = z.object({
  companyId: z.string().uuid(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().positive(),
        /** Override do salePrice (caso desconto manual) */
        unitPriceCentsOverride: z.number().int().min(0).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
  memberId: z.string().uuid().optional().nullable(),
  /** Método de pagamento — vira invoice paid imediatamente */
  paymentMethod: z.enum(['cash', 'pix', 'credit_card', 'debit_card', 'pending']),
  notes: z.string().max(500).optional().nullable(),
})

const StartInventoryInputSchema = z.object({
  companyId: z.string().uuid(),
  notes: z.string().max(500).optional().nullable(),
})

const AddInventoryCountInputSchema = z.object({
  inventoryId: z.string().uuid(),
  itemId: z.string().uuid(),
  physicalQty: z.number().min(0),
  notes: z.string().max(500).optional().nullable(),
})

const FinalizeInventoryInputSchema = z.object({
  inventoryId: z.string().uuid(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────

async function loadItemMovements(itemId: string, tenantId: string): Promise<Movement[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      unitCostCents: stockMovements.unitCostCents,
      at: stockMovements.at,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId)))
    .orderBy(asc(stockMovements.at))
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Movement['kind'],
    quantity: Number(r.quantity),
    unitCostCents: r.unitCostCents,
    at: r.at.toISOString(),
  }))
}

// ─── createStockItem ────────────────────────────────────────────────────

export const createStockItem = wrapServerAction(
  { module: 'estoque', action: 'item.create', resourceType: 'stock_items' },
  async (input: z.infer<typeof CreateItemInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateItemInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    try {
      const [row] = await db
        .insert(stockItems)
        .values({
          tenantId,
          companyId: parsed.companyId,
          sku: parsed.sku,
          name: parsed.name,
          category: parsed.category ?? null,
          unit: parsed.unit,
          costCents: parsed.costCents,
          salePriceCents: parsed.salePriceCents ?? null,
          minStock: parsed.minStock.toString(),
          isResale: parsed.isResale,
          barcode: parsed.barcode ?? null,
          costMethod: parsed.costMethod,
          createdByUserId: session.user.id,
        })
        .returning({ id: stockItems.id })
      setAuditResource(row!.id, { sku: parsed.sku })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `SKU "${parsed.sku}" já cadastrado nessa company`,
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const updateStockItem = wrapServerAction(
  { module: 'estoque', action: 'item.update', resourceType: 'stock_items' },
  async (input: z.infer<typeof UpdateItemInputSchema>, { session, setAuditResource }) => {
    const parsed = UpdateItemInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.name !== undefined) patch.name = parsed.name
    if (parsed.category !== undefined) patch.category = parsed.category
    if (parsed.salePriceCents !== undefined) patch.salePriceCents = parsed.salePriceCents
    if (parsed.minStock !== undefined) patch.minStock = parsed.minStock.toString()
    if (parsed.costMethod !== undefined) patch.costMethod = parsed.costMethod
    if (parsed.isResale !== undefined) patch.isResale = parsed.isResale
    const [row] = await db
      .update(stockItems)
      .set(patch)
      .where(and(eq(stockItems.id, parsed.itemId), eq(stockItems.tenantId, tenantId)))
      .returning({ id: stockItems.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Item não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { ok: true }
  },
)

export const listStockItems = wrapServerAction(
  { module: 'estoque', action: 'item.list' },
  async (
    input: { companyId?: string; includeArchived?: boolean; isResaleOnly?: boolean } | undefined,
    { session },
  ) => {
    const parsed = z
      .object({
        companyId: z.string().uuid().optional(),
        includeArchived: z.boolean().optional(),
        isResaleOnly: z.boolean().optional(),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(stockItems.tenantId, tenantId)]
    if (parsed.companyId) where.push(eq(stockItems.companyId, parsed.companyId))
    if (!parsed.includeArchived) where.push(isNull(stockItems.archivedAt))
    if (parsed.isResaleOnly) where.push(eq(stockItems.isResale, true))
    const rows = await db
      .select()
      .from(stockItems)
      .where(and(...where))
      .orderBy(asc(stockItems.name))
      .limit(500)
    return { items: rows }
  },
)

// ─── registerEntry / registerExit ───────────────────────────────────────

async function registerMovementInternal(input: {
  tenantId: string
  userId: string
  itemId: string
  kind: Movement['kind']
  quantity: number
  unitCostCents: number | null
  referenceDoc: string | null
  appointmentId: string | null
  invoiceId: string | null
  notes: string | null
}): Promise<{ id: string; alert: ReturnType<typeof detectLowStockCrossing> | null }> {
  // Carrega item pra companyId + minStock
  const [item] = await db
    .select({
      id: stockItems.id,
      companyId: stockItems.companyId,
      minStock: stockItems.minStock,
      costMethod: stockItems.costMethod,
    })
    .from(stockItems)
    .where(and(eq(stockItems.id, input.itemId), eq(stockItems.tenantId, input.tenantId)))
    .limit(1)
  if (!item)
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Item não encontrado',
      request_id: '',
    })

  // Saldo antes (pra detectar low_stock crossing)
  const movsBefore = await loadItemMovements(input.itemId, input.tenantId)
  const balanceBefore = calculateBalance(movsBefore)

  // Insert movimento
  const [row] = await db
    .insert(stockMovements)
    .values({
      tenantId: input.tenantId,
      companyId: item.companyId,
      itemId: input.itemId,
      kind: input.kind,
      quantity: input.quantity.toString(),
      unitCostCents: input.unitCostCents,
      referenceDoc: input.referenceDoc,
      appointmentId: input.appointmentId,
      invoiceId: input.invoiceId,
      userId: input.userId,
      notes: input.notes,
    })
    .returning({ id: stockMovements.id })

  // Recalcula saldo + alert
  const movsAfter = await loadItemMovements(input.itemId, input.tenantId)
  const balanceAfter = calculateBalance(movsAfter)
  const alert = detectLowStockCrossing({
    itemId: input.itemId,
    minStock: Number(item.minStock),
    balanceBefore,
    balanceAfter,
  })

  // Atualiza cost_cents se cost_method='custo_medio' e entrou estoque com custo
  if (item.costMethod === 'custo_medio' && input.unitCostCents != null) {
    const avg = calculateAverageCostCents(movsAfter)
    await db
      .update(stockItems)
      .set({ costCents: avg, updatedAt: new Date() })
      .where(eq(stockItems.id, input.itemId))
  }

  return { id: row!.id, alert: alert.shouldAlert ? alert : null }
}

export const registerEntry = wrapServerAction(
  { module: 'estoque', action: 'movement.entry', resourceType: 'stock_movements' },
  async (input: z.infer<typeof RegisterEntryInputSchema>, { session, setAuditResource }) => {
    const parsed = RegisterEntryInputSchema.parse(input)
    if (parsed.kind === 'entry_purchase' && parsed.unitCostCents == null) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'entry_purchase exige unitCostCents',
        request_id: '',
      })
    }
    const result = await registerMovementInternal({
      tenantId: session.logifit.tenantId,
      userId: session.user.id,
      itemId: parsed.itemId,
      kind: parsed.kind,
      quantity: parsed.quantity,
      unitCostCents: parsed.unitCostCents ?? null,
      referenceDoc: parsed.referenceDoc ?? null,
      appointmentId: null,
      invoiceId: null,
      notes: parsed.notes ?? null,
    })
    setAuditResource(result.id, { kind: parsed.kind, quantity: parsed.quantity })
    return result
  },
)

export const registerExit = wrapServerAction(
  { module: 'estoque', action: 'movement.exit', resourceType: 'stock_movements' },
  async (input: z.infer<typeof RegisterExitInputSchema>, { session, setAuditResource }) => {
    const parsed = RegisterExitInputSchema.parse(input)
    const result = await registerMovementInternal({
      tenantId: session.logifit.tenantId,
      userId: session.user.id,
      itemId: parsed.itemId,
      kind: parsed.kind,
      quantity: parsed.quantity,
      unitCostCents: null,
      referenceDoc: parsed.referenceDoc ?? null,
      appointmentId: parsed.appointmentId ?? null,
      invoiceId: null,
      notes: parsed.notes ?? null,
    })
    setAuditResource(result.id, { kind: parsed.kind, quantity: parsed.quantity })
    return result
  },
)

// ─── sellAtPos ───────────────────────────────────────────────────────────

export const sellAtPos = wrapServerAction(
  { module: 'estoque', action: 'pos.sell', resourceType: 'invoices' },
  async (input: z.infer<typeof SellAtPosInputSchema>, { session, setAuditResource }) => {
    const parsed = SellAtPosInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida member se informado
    if (parsed.memberId) {
      const [m] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
        .limit(1)
      if (!m)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Member não encontrado',
          request_id: '',
        })
    }

    // Carrega items + valida resale + calcula totais
    const itemIds = parsed.items.map((i) => i.itemId)
    const itemRows = await db
      .select({
        id: stockItems.id,
        name: stockItems.name,
        salePriceCents: stockItems.salePriceCents,
        isResale: stockItems.isResale,
        companyId: stockItems.companyId,
      })
      .from(stockItems)
      .where(
        and(
          eq(stockItems.tenantId, tenantId),
          sql`${stockItems.id} = ANY(${itemIds})`,
        ),
      )
    const itemMap = new Map(itemRows.map((i) => [i.id, i]))

    let totalCents = 0
    const lineItems: Array<{
      itemId: string
      name: string
      quantity: number
      unitPriceCents: number
      totalCents: number
    }> = []
    for (const li of parsed.items) {
      const item = itemMap.get(li.itemId)
      if (!item) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: `Item ${li.itemId} não encontrado`,
          request_id: '',
        })
      }
      if (!item.isResale) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Item "${item.name}" não é de revenda (is_resale=false)`,
          request_id: '',
        })
      }
      const unitPrice = li.unitPriceCentsOverride ?? item.salePriceCents ?? 0
      if (unitPrice <= 0) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Item "${item.name}" sem preço de venda`,
          request_id: '',
        })
      }
      const lineTotal = unitPrice * li.quantity
      totalCents += lineTotal
      lineItems.push({
        itemId: li.itemId,
        name: item.name,
        quantity: li.quantity,
        unitPriceCents: unitPrice,
        totalCents: lineTotal,
      })
    }

    if (totalCents <= 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Total da venda deve ser positivo',
        request_id: '',
      })

    // Sprint 24a MVP: gera apenas movimentações exit_sale com referência POS.
    // invoices (Sprint 04) exige contractId — não funciona pra venda de balcão sem contrato.
    // Sprint 24b integra com `accounts_receivable` (Sprint 15) usando chartAccountId
    // configurável + emissão fiscal NFC-e via Focus NFe (ADR 0059) quando ativo.
    const posRef = `pos:${session.user.id}:${Date.now()}`
    const movementIds: string[] = []
    for (const li of lineItems) {
      const result = await registerMovementInternal({
        tenantId,
        userId: session.user.id,
        itemId: li.itemId,
        kind: 'exit_sale',
        quantity: li.quantity,
        unitCostCents: null,
        referenceDoc: posRef,
        appointmentId: null,
        invoiceId: null,
        notes: `POS ${parsed.paymentMethod} — ${li.quantity}x R$ ${(li.unitPriceCents / 100).toFixed(2)}`,
      })
      movementIds.push(result.id)
    }

    setAuditResource(movementIds[0] ?? posRef, {
      itemCount: lineItems.length,
      totalCents,
      paymentMethod: parsed.paymentMethod,
      memberId: parsed.memberId,
      posRef,
    })
    return {
      posRef,
      totalCents,
      lineItems,
      movementIds,
      financeiroIntegration:
        'Sprint 24b: criar accounts_receivable + emissão NFC-e Focus NFe (ADR 0059)',
    }
  },
)

// ─── getItemBalance ──────────────────────────────────────────────────────

export const getItemBalance = wrapServerAction(
  { module: 'estoque', action: 'item.balance' },
  async (input: { itemId: string }, { session }) => {
    const parsed = z.object({ itemId: z.string().uuid() }).parse(input)
    const tenantId = session.logifit.tenantId
    const movements = await loadItemMovements(parsed.itemId, tenantId)
    const balance = calculateBalance(movements)
    const avgCost = calculateAverageCostCents(movements)
    return { itemId: parsed.itemId, balance, averageCostCents: avgCost }
  },
)

// ─── listLowStockItems ──────────────────────────────────────────────────

export const listLowStockItems = wrapServerAction(
  { module: 'estoque', action: 'item.low_stock' },
  async (input: { companyId?: string } | undefined, { session }) => {
    const parsed = z.object({ companyId: z.string().uuid().optional() }).parse(input ?? {})
    const tenantId = session.logifit.tenantId

    // Query agregada via SQL pra eficiência
    const result = await db.execute(sql`
      WITH balances AS (
        SELECT
          si.id AS item_id,
          si.sku,
          si.name,
          si.min_stock,
          COALESCE(SUM(CASE WHEN sm.kind LIKE 'entry_%' THEN sm.quantity ELSE -sm.quantity END), 0) AS balance
        FROM stock_items si
        LEFT JOIN stock_movements sm ON sm.item_id = si.id
        WHERE si.tenant_id = ${tenantId}
          AND si.active = true
          ${parsed.companyId ? sql`AND si.company_id = ${parsed.companyId}` : sql``}
        GROUP BY si.id, si.sku, si.name, si.min_stock
      )
      SELECT * FROM balances WHERE balance <= min_stock ORDER BY (min_stock - balance) DESC, name
    `)
    return { items: result.rows as Array<Record<string, unknown>> }
  },
)

// ─── Inventory flow ─────────────────────────────────────────────────────

export const startInventory = wrapServerAction(
  { module: 'estoque', action: 'inventory.start', resourceType: 'stock_inventories' },
  async (input: z.infer<typeof StartInventoryInputSchema>, { session, setAuditResource }) => {
    const parsed = StartInventoryInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .insert(stockInventories)
      .values({
        tenantId,
        companyId: parsed.companyId,
        countedByUserId: session.user.id,
        status: 'draft',
        notes: parsed.notes ?? null,
      })
      .returning({ id: stockInventories.id })
    setAuditResource(row!.id, {})
    return { id: row!.id }
  },
)

export const addInventoryCount = wrapServerAction(
  { module: 'estoque', action: 'inventory.count', resourceType: 'stock_inventory_entries' },
  async (input: z.infer<typeof AddInventoryCountInputSchema>, { session, setAuditResource }) => {
    const parsed = AddInventoryCountInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [inv] = await db
      .select({ id: stockInventories.id, status: stockInventories.status })
      .from(stockInventories)
      .where(
        and(
          eq(stockInventories.id, parsed.inventoryId),
          eq(stockInventories.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!inv)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Inventário não encontrado',
        request_id: '',
      })
    if (inv.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Inventário já finalizado',
        request_id: '',
      })

    // Calcula systemQty
    const movements = await loadItemMovements(parsed.itemId, tenantId)
    const systemQty = calculateBalance(movements)
    const difference = parsed.physicalQty - systemQty

    await db
      .insert(stockInventoryEntries)
      .values({
        inventoryId: parsed.inventoryId,
        itemId: parsed.itemId,
        systemQty: systemQty.toString(),
        physicalQty: parsed.physicalQty.toString(),
        difference: difference.toString(),
        notes: parsed.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [stockInventoryEntries.inventoryId, stockInventoryEntries.itemId],
        set: {
          systemQty: systemQty.toString(),
          physicalQty: parsed.physicalQty.toString(),
          difference: difference.toString(),
          notes: parsed.notes ?? null,
        },
      })
    setAuditResource(parsed.inventoryId, { itemId: parsed.itemId, difference })
    return { difference, systemQty }
  },
)

export const finalizeInventory = wrapServerAction(
  { module: 'estoque', action: 'inventory.finalize', resourceType: 'stock_inventories' },
  async (
    input: z.infer<typeof FinalizeInventoryInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = FinalizeInventoryInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [inv] = await db
      .select({
        id: stockInventories.id,
        companyId: stockInventories.companyId,
        status: stockInventories.status,
      })
      .from(stockInventories)
      .where(
        and(
          eq(stockInventories.id, parsed.inventoryId),
          eq(stockInventories.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!inv)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Inventário não encontrado',
        request_id: '',
      })
    if (inv.status !== 'draft')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Inventário já finalizado',
        request_id: '',
      })

    // Carrega entries
    const entries = await db
      .select()
      .from(stockInventoryEntries)
      .where(eq(stockInventoryEntries.inventoryId, parsed.inventoryId))

    let adjustments = 0
    for (const e of entries) {
      const diff = Number(e.difference)
      if (diff === 0) continue
      const kind = diff > 0 ? 'entry_adjustment' : 'exit_adjustment'
      await db.insert(stockMovements).values({
        tenantId,
        companyId: inv.companyId,
        itemId: e.itemId,
        kind,
        quantity: Math.abs(diff).toString(),
        unitCostCents: null,
        referenceDoc: `inventory:${parsed.inventoryId}`,
        inventoryId: parsed.inventoryId,
        userId: session.user.id,
        notes: e.notes,
      })
      adjustments += 1
    }

    await db
      .update(stockInventories)
      .set({
        status: 'finalized',
        finalizedAt: new Date(),
        finalizedByUserId: session.user.id,
      })
      .where(eq(stockInventories.id, parsed.inventoryId))
    setAuditResource(parsed.inventoryId, { adjustments })
    return { ok: true, adjustments }
  },
)

// ─── List movements (auditoria) ─────────────────────────────────────────

export const listMovements = wrapServerAction(
  { module: 'estoque', action: 'movement.list' },
  async (input: { itemId?: string; limit?: number } | undefined, { session }) => {
    const parsed = z
      .object({
        itemId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(stockMovements.tenantId, tenantId)]
    if (parsed.itemId) where.push(eq(stockMovements.itemId, parsed.itemId))
    const rows = await db
      .select({
        id: stockMovements.id,
        itemId: stockMovements.itemId,
        kind: stockMovements.kind,
        quantity: stockMovements.quantity,
        unitCostCents: stockMovements.unitCostCents,
        referenceDoc: stockMovements.referenceDoc,
        notes: stockMovements.notes,
        at: stockMovements.at,
        itemName: stockItems.name,
        itemSku: stockItems.sku,
      })
      .from(stockMovements)
      .leftJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
      .where(and(...where))
      .orderBy(desc(stockMovements.at))
      .limit(parsed.limit)
    return { movements: rows }
  },
)

export const archiveStockItem = wrapServerAction(
  { module: 'estoque', action: 'item.archive', resourceType: 'stock_items' },
  async (input: { itemId: string }, { session, setAuditResource }) => {
    const parsed = z.object({ itemId: z.string().uuid() }).parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(stockItems)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(and(eq(stockItems.id, parsed.itemId), eq(stockItems.tenantId, tenantId)))
      .returning({ id: stockItems.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Item não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { ok: true }
  },
)
