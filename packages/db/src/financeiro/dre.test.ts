import { describe, expect, it } from 'vitest'
import { calculateDre, forecastRevenue } from './dre'

const period = {
  from: new Date('2026-05-01T00:00:00.000Z'),
  to: new Date('2026-05-31T23:59:59.999Z'),
}

describe('calculateDre — receita', () => {
  it('soma paid no período via paid_at', () => {
    const r = calculateDre({
      period,
      invoices: [
        { amountCents: 15000, status: 'paid', paidAt: new Date('2026-05-10'), dueAt: new Date('2026-05-05') },
        { amountCents: 25000, status: 'paid', paidAt: new Date('2026-05-20'), dueAt: new Date('2026-05-15') },
        // Fora do período (paid em abril)
        { amountCents: 99999, status: 'paid', paidAt: new Date('2026-04-15'), dueAt: new Date('2026-04-10') },
      ],
      costEntries: [],
    })
    expect(r.revenue.paidCents).toBe(40000)
  })

  it('separa pending vs paid via due_at vs paid_at', () => {
    const r = calculateDre({
      period,
      invoices: [
        { amountCents: 10000, status: 'paid', paidAt: new Date('2026-05-15'), dueAt: new Date('2026-05-10') },
        { amountCents: 5000, status: 'pending', paidAt: null, dueAt: new Date('2026-05-20') },
        { amountCents: 3000, status: 'overdue', paidAt: null, dueAt: new Date('2026-05-05') },
      ],
      costEntries: [],
    })
    expect(r.revenue.paidCents).toBe(10000)
    expect(r.revenue.pendingCents).toBe(5000)
    expect(r.revenue.overdueCents).toBe(3000)
    expect(r.revenue.grossCents).toBe(18000)
  })

  it('refunded conta separado', () => {
    const r = calculateDre({
      period,
      invoices: [
        { amountCents: 10000, status: 'paid', paidAt: new Date('2026-05-10'), dueAt: new Date('2026-05-05') },
        { amountCents: 2000, status: 'refunded', paidAt: new Date('2026-05-25'), dueAt: new Date('2026-05-05') },
      ],
      costEntries: [],
    })
    expect(r.revenue.paidCents).toBe(10000)
    expect(r.revenue.refundedCents).toBe(2000)
    // refunded não entra em gross
    expect(r.revenue.grossCents).toBe(10000)
  })
})

describe('calculateDre — custos', () => {
  it('agrupa por categoria + tipo', () => {
    const r = calculateDre({
      period,
      invoices: [],
      costEntries: [
        {
          amountCents: 350000,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: new Date('2026-05-05'),
        },
        {
          amountCents: 800000,
          categoryId: 'cat-2',
          categoryName: 'Folha',
          categoryType: 'fixed',
          incurredAt: new Date('2026-05-30'),
        },
        {
          amountCents: 50000,
          categoryId: 'cat-3',
          categoryName: 'Marketing',
          categoryType: 'variable',
          incurredAt: new Date('2026-05-15'),
        },
        {
          amountCents: 30000,
          categoryId: 'cat-3',
          categoryName: 'Marketing',
          categoryType: 'variable',
          incurredAt: new Date('2026-05-20'),
        },
      ],
    })
    expect(r.costs.totalCents).toBe(1230000)
    expect(r.costs.byType.fixedCents).toBe(1150000)
    expect(r.costs.byType.variableCents).toBe(80000)
    expect(r.costs.byCategory.length).toBe(3)
    // Maior categoria primeiro
    expect(r.costs.byCategory[0]!.categoryId).toBe('cat-2')
    expect(r.costs.byCategory[0]!.totalCents).toBe(800000)
    // Marketing agregou 2 entries
    const mkt = r.costs.byCategory.find((c) => c.categoryId === 'cat-3')!
    expect(mkt.count).toBe(2)
    expect(mkt.totalCents).toBe(80000)
  })

  it('exclui custos fora do período', () => {
    const r = calculateDre({
      period,
      invoices: [],
      costEntries: [
        // Abril (fora)
        {
          amountCents: 99999,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: new Date('2026-04-05'),
        },
        // Maio (dentro)
        {
          amountCents: 350000,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: new Date('2026-05-05'),
        },
      ],
    })
    expect(r.costs.totalCents).toBe(350000)
    expect(r.counts.costEntries).toBe(1)
  })
})

describe('calculateDre — margens', () => {
  it('margin = paid - costs', () => {
    const r = calculateDre({
      period,
      invoices: [
        { amountCents: 1000000, status: 'paid', paidAt: new Date('2026-05-10'), dueAt: new Date('2026-05-05') },
      ],
      costEntries: [
        {
          amountCents: 300000,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: new Date('2026-05-05'),
        },
      ],
    })
    expect(r.margins.grossCents).toBe(700000)
    expect(r.margins.grossPercent).toBe(70)
  })

  it('paid=0 não divide por zero', () => {
    const r = calculateDre({
      period,
      invoices: [],
      costEntries: [
        {
          amountCents: 100,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: new Date('2026-05-05'),
        },
      ],
    })
    expect(r.margins.grossPercent).toBe(0)
    expect(r.margins.grossCents).toBe(-100)
  })

  it('incurredAt como string ISO funciona', () => {
    const r = calculateDre({
      period,
      invoices: [],
      costEntries: [
        {
          amountCents: 5000,
          categoryId: 'cat-1',
          categoryName: 'Aluguel',
          categoryType: 'fixed',
          incurredAt: '2026-05-15T10:00:00.000Z',
        },
      ],
    })
    expect(r.costs.totalCents).toBe(5000)
  })
})

describe('forecastRevenue', () => {
  it('projeta 3 meses com churn 5%', () => {
    const r = forecastRevenue({
      baselineMonthlyCents: 10000000, // R$ 100k
      monthlyChurnRate: 0.05,
      monthsAhead: 3,
    })
    expect(r.monthly.length).toBe(3)
    expect(r.monthly[0]!.projectedCents).toBe(9500000) // 100k × 0.95
    expect(r.monthly[1]!.projectedCents).toBe(9025000) // × 0.95²
    expect(r.monthly[2]!.projectedCents).toBe(8573750) // × 0.95³
  })

  it('intervalo low/high', () => {
    const r = forecastRevenue({
      baselineMonthlyCents: 10000000,
      monthlyChurnRate: 0.05,
      monthsAhead: 1,
    })
    const first = r.monthly[0]!
    expect(first.lowCents).toBe(8075000) // 9.5M × 0.85
    expect(first.highCents).toBe(10450000) // 9.5M × 1.1
  })

  it('churn=0 mantém baseline', () => {
    const r = forecastRevenue({
      baselineMonthlyCents: 5000000,
      monthlyChurnRate: 0,
      monthsAhead: 12,
    })
    expect(r.monthly.every((m) => m.projectedCents === 5000000)).toBe(true)
    expect(r.totalProjectedCents).toBe(60000000)
  })

  it('valores inválidos retornam vazio', () => {
    expect(forecastRevenue({ baselineMonthlyCents: -1, monthlyChurnRate: 0.1, monthsAhead: 3 }).monthly).toEqual([])
    expect(forecastRevenue({ baselineMonthlyCents: 1000, monthlyChurnRate: 1.5, monthsAhead: 3 }).monthly).toEqual([])
    expect(forecastRevenue({ baselineMonthlyCents: 1000, monthlyChurnRate: 0.1, monthsAhead: 0 }).monthly).toEqual([])
    expect(forecastRevenue({ baselineMonthlyCents: 1000, monthlyChurnRate: 0.1, monthsAhead: 100 }).monthly).toEqual([])
  })

  it('total projetado bate com soma', () => {
    const r = forecastRevenue({
      baselineMonthlyCents: 10000000,
      monthlyChurnRate: 0.05,
      monthsAhead: 3,
    })
    const sum = r.monthly.reduce((acc, m) => acc + m.projectedCents, 0)
    expect(r.totalProjectedCents).toBe(sum)
  })
})
