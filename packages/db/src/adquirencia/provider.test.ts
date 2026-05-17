/**
 * Provider abstrato tests — Sprint 18 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  feeRateFor,
  getAdapter,
  MockAcquirerProvider,
} from './provider'

describe('MockAcquirerProvider', () => {
  it('testConnection sem merchantId falha', async () => {
    const adapter = new MockAcquirerProvider()
    const r = await adapter.testConnection({}, false)
    expect(r.ok).toBe(false)
    expect(r.merchantName).toBeNull()
    expect(r.errorMessage).toContain('merchantId')
  })

  it('testConnection com merchantId sucede', async () => {
    const adapter = new MockAcquirerProvider()
    const r = await adapter.testConnection({ merchantId: 'XYZ-001' }, false)
    expect(r.ok).toBe(true)
    expect(r.merchantName).toContain('XYZ-001')
  })

  it('fetchSales gera vendas determinísticas por range × merchant', async () => {
    const adapter = new MockAcquirerProvider()
    const r1 = await adapter.fetchSales(
      { merchantId: 'A' },
      false,
      { from: '2026-05-01', to: '2026-05-03' },
    )
    const r2 = await adapter.fetchSales(
      { merchantId: 'A' },
      false,
      { from: '2026-05-01', to: '2026-05-03' },
    )
    expect(r1).toHaveLength(9) // 3 dias × 3 vendas
    expect(r1.map((s) => s.externalId)).toEqual(r2.map((s) => s.externalId))
  })

  it('fetchSales: net = gross - fee em toda venda', async () => {
    const adapter = new MockAcquirerProvider()
    const sales = await adapter.fetchSales(
      { merchantId: 'X' },
      false,
      { from: '2026-05-01', to: '2026-05-01' },
    )
    for (const s of sales) {
      expect(s.netAmountCents).toBe(s.grossAmountCents - s.feeCents)
      expect(s.grossAmountCents).toBeGreaterThan(0)
    }
  })

  it('fetchSales: range invertido retorna vazio', async () => {
    const adapter = new MockAcquirerProvider()
    const sales = await adapter.fetchSales(
      { merchantId: 'X' },
      false,
      { from: '2026-05-10', to: '2026-05-01' },
    )
    expect(sales).toHaveLength(0)
  })

  it('requestAnticipation aprova com taxa 1.99%', async () => {
    const adapter = new MockAcquirerProvider()
    const r = await adapter.requestAnticipation(
      { merchantId: 'X' },
      false,
      { salesIds: ['s1', 's2'], externalSaleIds: ['NSU1', 'NSU2'], originalAmountCents: 100_000 },
    )
    expect(r.status).toBe('credited')
    expect(r.feeCents).toBe(1990) // 1.99% de 100k
    expect(r.anticipatedAmountCents).toBe(98010)
    expect(r.effectiveRatePct).toBe('1.99')
  })
})

describe('getAdapter', () => {
  it('retorna MockAcquirerProvider para provider=mock', () => {
    const a = getAdapter('mock')
    expect(a.provider).toBe('mock')
  })

  it('falha pedindo POC pra provider real', () => {
    expect(() => getAdapter('stone')).toThrow(/POC Sprint 18b/)
    expect(() => getAdapter('cielo')).toThrow(/POC Sprint 18b/)
  })
})

describe('feeRateFor', () => {
  it('crédito Stone à vista = 2.79%', () => {
    expect(feeRateFor('stone', 'credit', 1)).toBeCloseTo(2.79, 2)
  })

  it('crédito Stone parcelado 3x adiciona 2 × 0.18 = 0.36 → 3.15%', () => {
    expect(feeRateFor('stone', 'credit', 3)).toBeCloseTo(3.15, 2)
  })

  it('débito Cielo = 1.39% (sem variação por parcelas)', () => {
    expect(feeRateFor('cielo', 'debit', 1)).toBeCloseTo(1.39, 2)
    expect(feeRateFor('cielo', 'debit', 5)).toBeCloseTo(1.39, 2)
  })

  it('PIX PagSeguro = 0.99%', () => {
    expect(feeRateFor('pagseguro', 'pix', 1)).toBeCloseTo(0.99, 2)
  })
})
