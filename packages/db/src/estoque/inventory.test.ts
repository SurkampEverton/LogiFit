/**
 * inventory.ts tests — Sprint 24 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  calculateAverageCostCents,
  calculateBalance,
  calculateInventoryAdjustment,
  calculatePeps,
  detectLowStockCrossing,
  signOfKind,
  type Movement,
} from './inventory'

const m = (
  kind: Movement['kind'],
  quantity: number,
  at: string,
  unitCostCents: number | null = null,
): Movement => ({
  id: `m-${at}-${kind}`,
  kind,
  quantity,
  unitCostCents,
  at,
})

describe('signOfKind', () => {
  it('entry_* = +1', () => {
    expect(signOfKind('entry_purchase')).toBe(1)
    expect(signOfKind('entry_adjustment')).toBe(1)
    expect(signOfKind('entry_return_from_customer')).toBe(1)
  })

  it('exit_* = -1', () => {
    expect(signOfKind('exit_consumption')).toBe(-1)
    expect(signOfKind('exit_sale')).toBe(-1)
    expect(signOfKind('exit_loss')).toBe(-1)
    expect(signOfKind('exit_adjustment')).toBe(-1)
    expect(signOfKind('exit_return_to_supplier')).toBe(-1)
  })
})

describe('calculateBalance', () => {
  it('saldo 0 sem movimentos', () => {
    expect(calculateBalance([])).toBe(0)
  })

  it('entry 100 - exit 30 = 70', () => {
    const r = calculateBalance([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('exit_sale', 30, '2026-05-15'),
    ])
    expect(r).toBe(70)
  })

  it('múltiplas entries + exits', () => {
    const r = calculateBalance([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('entry_purchase', 50, '2026-05-05', 550),
      m('exit_consumption', 20, '2026-05-10'),
      m('exit_sale', 30, '2026-05-15'),
      m('exit_loss', 5, '2026-05-20'),
      m('entry_adjustment', 10, '2026-05-25'),
    ])
    expect(r).toBe(105) // 100 + 50 - 20 - 30 - 5 + 10
  })

  it('decimais (peso/volume) corretamente somados', () => {
    const r = calculateBalance([
      m('entry_purchase', 2.5, '2026-05-01', 100),
      m('exit_consumption', 0.75, '2026-05-10'),
    ])
    expect(r).toBe(1.75)
  })
})

describe('calculateAverageCostCents', () => {
  it('1 entry → custo = entry cost', () => {
    const r = calculateAverageCostCents([m('entry_purchase', 100, '2026-05-01', 500)])
    expect(r).toBe(500)
  })

  it('2 entries com custos diferentes → média ponderada', () => {
    // (100 × 500 + 50 × 700) / 150 = (50000 + 35000) / 150 = 566.67 → 567
    const r = calculateAverageCostCents([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('entry_purchase', 50, '2026-05-05', 700),
    ])
    expect(r).toBe(567)
  })

  it('entry sem unitCost ignorada', () => {
    const r = calculateAverageCostCents([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('entry_adjustment', 50, '2026-05-05'), // sem cost
    ])
    expect(r).toBe(500)
  })

  it('saídas ignoradas (não afetam média)', () => {
    const r = calculateAverageCostCents([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('exit_sale', 50, '2026-05-10', 800),
    ])
    expect(r).toBe(500)
  })

  it('sem entries com custo → 0', () => {
    const r = calculateAverageCostCents([m('exit_consumption', 10, '2026-05-01')])
    expect(r).toBe(0)
  })
})

describe('calculatePeps (FIFO)', () => {
  it('consome lote mais antigo primeiro', () => {
    // Lote 1: 100un @ R$5,00 (data 01/05)
    // Lote 2: 100un @ R$7,00 (data 10/05)
    // Saída: 50un (consome lote 1)
    const r = calculatePeps([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('entry_purchase', 100, '2026-05-10', 700),
      m('exit_sale', 50, '2026-05-15'),
    ])
    expect(r.finalBalance).toBe(150)
    expect(r.cogsCents).toBe(25000) // 50 × 500 (lote antigo)
    expect(r.currentInventoryCostCents).toBe(25000 + 70000) // 50 × 500 + 100 × 700
    expect(r.remainingLots).toHaveLength(2)
    expect(r.remainingLots[0]!.qty).toBe(50)
    expect(r.remainingLots[0]!.unitCostCents).toBe(500)
  })

  it('saída maior que primeiro lote consome múltiplos', () => {
    // Lote 1: 50un @ R$5,00
    // Lote 2: 100un @ R$7,00
    // Saída: 80un → 50 do lote 1 + 30 do lote 2
    const r = calculatePeps([
      m('entry_purchase', 50, '2026-05-01', 500),
      m('entry_purchase', 100, '2026-05-10', 700),
      m('exit_sale', 80, '2026-05-15'),
    ])
    expect(r.finalBalance).toBe(70)
    expect(r.cogsCents).toBe(50 * 500 + 30 * 700) // 25000 + 21000 = 46000
    expect(r.currentInventoryCostCents).toBe(70 * 700) // 49000
    expect(r.remainingLots).toHaveLength(1)
    expect(r.remainingLots[0]!.qty).toBe(70)
    expect(r.remainingLots[0]!.unitCostCents).toBe(700)
  })

  it('múltiplas exits + entries intercaladas', () => {
    const r = calculatePeps([
      m('entry_purchase', 100, '2026-05-01', 500),
      m('exit_sale', 30, '2026-05-05'),
      m('entry_purchase', 50, '2026-05-10', 600),
      m('exit_sale', 70, '2026-05-15'), // consome 70 do lote 1 (restavam 70)
      m('exit_sale', 20, '2026-05-20'), // consome lote 2 (50 disponível)
    ])
    expect(r.finalBalance).toBe(30) // 100 - 30 + 50 - 70 - 20
    // cogs: 30×500 + 70×500 + 20×600 = 15000+35000+12000 = 62000
    expect(r.cogsCents).toBe(62000)
    expect(r.remainingLots[0]!.qty).toBe(30)
    expect(r.remainingLots[0]!.unitCostCents).toBe(600)
  })

  it('movimentações fora de ordem são ordenadas internamente', () => {
    const r = calculatePeps([
      m('exit_sale', 30, '2026-05-15'),
      m('entry_purchase', 100, '2026-05-01', 500),
    ])
    expect(r.finalBalance).toBe(70)
    expect(r.cogsCents).toBe(15000)
  })

  it('entry sem unitCost vira lote @ 0', () => {
    const r = calculatePeps([
      m('entry_adjustment', 50, '2026-05-01'),
      m('exit_sale', 30, '2026-05-15'),
    ])
    expect(r.finalBalance).toBe(20)
    expect(r.cogsCents).toBe(0)
  })
})

describe('detectLowStockCrossing', () => {
  it('saldo cruza pra baixo do min → crossedDown=true', () => {
    const r = detectLowStockCrossing({
      itemId: 'i1',
      minStock: 10,
      balanceBefore: 12,
      balanceAfter: 8,
    })
    expect(r.crossedDown).toBe(true)
    expect(r.shouldAlert).toBe(true)
  })

  it('saldo já estava abaixo do min — não cruzou', () => {
    const r = detectLowStockCrossing({
      itemId: 'i1',
      minStock: 10,
      balanceBefore: 5,
      balanceAfter: 4,
    })
    expect(r.crossedDown).toBe(false)
    expect(r.shouldAlert).toBe(true) // ainda abaixo, então shouldAlert
  })

  it('saldo aumentou acima do min — sem alerta', () => {
    const r = detectLowStockCrossing({
      itemId: 'i1',
      minStock: 10,
      balanceBefore: 5,
      balanceAfter: 20,
    })
    expect(r.crossedDown).toBe(false)
    expect(r.shouldAlert).toBe(false)
  })

  it('saldo exatamente no min → alerta', () => {
    const r = detectLowStockCrossing({
      itemId: 'i1',
      minStock: 10,
      balanceBefore: 15,
      balanceAfter: 10,
    })
    expect(r.crossedDown).toBe(true)
    expect(r.shouldAlert).toBe(true)
  })
})

describe('calculateInventoryAdjustment', () => {
  it('physical < system → exit_adjustment', () => {
    const r = calculateInventoryAdjustment({
      itemId: 'i1',
      systemQty: 100,
      physicalQty: 95,
    })
    expect(r.difference).toBe(-5)
    expect(r.adjustmentKind).toBe('exit_adjustment')
    expect(r.adjustmentQty).toBe(5)
  })

  it('physical > system → entry_adjustment', () => {
    const r = calculateInventoryAdjustment({
      itemId: 'i1',
      systemQty: 100,
      physicalQty: 105,
    })
    expect(r.difference).toBe(5)
    expect(r.adjustmentKind).toBe('entry_adjustment')
    expect(r.adjustmentQty).toBe(5)
  })

  it('physical == system → sem ajuste', () => {
    const r = calculateInventoryAdjustment({
      itemId: 'i1',
      systemQty: 100,
      physicalQty: 100,
    })
    expect(r.difference).toBe(0)
    expect(r.adjustmentKind).toBeNull()
    expect(r.adjustmentQty).toBe(0)
  })
})
