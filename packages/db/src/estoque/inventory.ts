/**
 * Cálculo de saldo + custo (PEPS / médio) — Sprint 24 Faixa B.1 (ADR 0087 esperado).
 *
 * Funções puras. Server Action carrega movimentações + chama.
 *
 * **Saldo:** sum(quantity × sign(kind)).
 * **Custo (PEPS):** consome lotes na ordem de entrada (FIFO); cada exit
 * consome do lote mais antigo até zerar.
 * **Custo (médio):** soma (qty × custo) / soma qty para todas as entradas
 * vigentes.
 *
 * **Alerta low_stock:** disparado quando saldo cruza min_stock pra baixo
 * (detecção comparando before/after de uma movimentação).
 */

// ─── Tipos ──────────────────────────────────────────────────────────────

export type MovementKind =
  | 'entry_purchase'
  | 'entry_adjustment'
  | 'entry_return_from_customer'
  | 'exit_consumption'
  | 'exit_sale'
  | 'exit_loss'
  | 'exit_adjustment'
  | 'exit_return_to_supplier'

export interface Movement {
  id: string
  kind: MovementKind
  /** Sempre positivo (kind define sinal) */
  quantity: number
  unitCostCents: number | null
  /** ISO timestamp */
  at: string
}

export type CostMethod = 'peps' | 'custo_medio'

/**
 * Retorna +1 ou -1 conforme o sinal do `kind`.
 */
export function signOfKind(kind: MovementKind): 1 | -1 {
  return kind.startsWith('entry_') ? 1 : -1
}

/**
 * Saldo atual = sum(quantity × sign(kind)).
 */
export function calculateBalance(movements: Movement[]): number {
  return movements.reduce((sum, m) => sum + signOfKind(m.kind) * Number(m.quantity), 0)
}

// ─── Custo médio ────────────────────────────────────────────────────────

/**
 * Custo médio ponderado considerando todas as entradas com unitCost.
 * Saídas não afetam custo médio (no método contábil tradicional).
 *
 * Retorna 0 se não houver entradas com custo.
 */
export function calculateAverageCostCents(movements: Movement[]): number {
  let totalQty = 0
  let totalCost = 0
  for (const m of movements) {
    if (signOfKind(m.kind) !== 1) continue
    if (m.unitCostCents == null) continue
    const qty = Number(m.quantity)
    totalQty += qty
    totalCost += qty * m.unitCostCents
  }
  if (totalQty === 0) return 0
  return Math.round(totalCost / totalQty)
}

// ─── PEPS (FIFO) ────────────────────────────────────────────────────────

interface Lot {
  remainingQty: number
  unitCostCents: number
  at: string
}

/**
 * Aplica PEPS sobre lista cronológica de movimentações. Retorna:
 *   - finalBalance: saldo atual
 *   - cogs: cost of goods sold (custo das saídas)
 *   - currentInventoryCost: custo do estoque remanescente
 *
 * Movimentações **devem chegar ordenadas por `at` asc**.
 */
export interface PepsResult {
  finalBalance: number
  cogsCents: number
  currentInventoryCostCents: number
  /** Lotes ainda em estoque (PEPS pode revelar lotes antigos) */
  remainingLots: Array<{ at: string; qty: number; unitCostCents: number }>
}

export function calculatePeps(movements: Movement[]): PepsResult {
  const sorted = [...movements].sort((a, b) => a.at.localeCompare(b.at))
  const lots: Lot[] = []
  let cogs = 0

  for (const m of sorted) {
    const sign = signOfKind(m.kind)
    const qty = Number(m.quantity)
    if (sign === 1) {
      // Entry: cria lote
      const cost = m.unitCostCents ?? 0
      lots.push({ remainingQty: qty, unitCostCents: cost, at: m.at })
    } else {
      // Exit: consome lotes do mais antigo
      let toConsume = qty
      while (toConsume > 0 && lots.length > 0) {
        const lot = lots[0]!
        const take = Math.min(toConsume, lot.remainingQty)
        cogs += take * lot.unitCostCents
        lot.remainingQty -= take
        toConsume -= take
        if (lot.remainingQty <= 0) lots.shift()
      }
      // Se toConsume > 0: estoque negativo (cogs incompleto; sinaliza erro upstream)
    }
  }

  const finalBalance = lots.reduce((s, l) => s + l.remainingQty, 0)
  const currentInventoryCostCents = Math.round(
    lots.reduce((s, l) => s + l.remainingQty * l.unitCostCents, 0),
  )
  return {
    finalBalance,
    cogsCents: cogs,
    currentInventoryCostCents,
    remainingLots: lots.map((l) => ({
      at: l.at,
      qty: l.remainingQty,
      unitCostCents: l.unitCostCents,
    })),
  }
}

// ─── Low stock alert ────────────────────────────────────────────────────

export interface LowStockAlert {
  itemId: string
  currentBalance: number
  minStock: number
  shouldAlert: boolean
  /** True quando o saldo CRUZOU pra baixo do mínimo (não apenas atingiu) */
  crossedDown: boolean
}

/**
 * Detecta se uma movimentação fez o saldo cruzar pra baixo do min_stock.
 * Útil pra disparar evento `stock.low_stock_alert` no Server Action após registrar.
 */
export function detectLowStockCrossing(input: {
  itemId: string
  minStock: number
  balanceBefore: number
  balanceAfter: number
}): LowStockAlert {
  const crossedDown =
    input.balanceBefore > input.minStock && input.balanceAfter <= input.minStock
  return {
    itemId: input.itemId,
    currentBalance: input.balanceAfter,
    minStock: input.minStock,
    shouldAlert: input.balanceAfter <= input.minStock,
    crossedDown,
  }
}

// ─── Cálculo de diferença de inventário ────────────────────────────────

export interface InventoryAdjustment {
  itemId: string
  systemQty: number
  physicalQty: number
  difference: number
  adjustmentKind: 'entry_adjustment' | 'exit_adjustment' | null
  adjustmentQty: number
}

export function calculateInventoryAdjustment(input: {
  itemId: string
  systemQty: number
  physicalQty: number
}): InventoryAdjustment {
  const diff = input.physicalQty - input.systemQty
  if (diff === 0) {
    return {
      ...input,
      difference: 0,
      adjustmentKind: null,
      adjustmentQty: 0,
    }
  }
  return {
    ...input,
    difference: diff,
    adjustmentKind: diff > 0 ? 'entry_adjustment' : 'exit_adjustment',
    adjustmentQty: Math.abs(diff),
  }
}

// ─── Giro / turnover ───────────────────────────────────────────────────

/**
 * Giro de estoque = COGS / saldo médio do período.
 * Saldo médio = (saldo_inicial + saldo_final) / 2.
 *
 * Sem entries ou sem exits no período → giro 0.
 */
export function calculateTurnover(input: {
  movements: Movement[]
  periodStart: string
  periodEnd: string
  initialBalance: number
}): { turnover: number; avgBalance: number; cogsCents: number; finalBalance: number } {
  const inPeriod = input.movements.filter(
    (m) => m.at >= input.periodStart && m.at <= input.periodEnd,
  )
  let cogs = 0
  let runningBalance = input.initialBalance
  for (const m of inPeriod.sort((a, b) => a.at.localeCompare(b.at))) {
    const sign = signOfKind(m.kind)
    if (sign === -1) {
      cogs += Number(m.quantity) * (m.unitCostCents ?? 0)
    }
    runningBalance += sign * Number(m.quantity)
  }
  const avgBalance = (input.initialBalance + runningBalance) / 2
  const turnover = avgBalance === 0 ? 0 : cogs / (avgBalance * (input.movements[0]?.unitCostCents ?? 1))
  return {
    turnover: Number(turnover.toFixed(2)),
    avgBalance,
    cogsCents: cogs,
    finalBalance: runningBalance,
  }
}
