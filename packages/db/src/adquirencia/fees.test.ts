/**
 * fees.ts tests — Sprint 18 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  type FranchiseAgreement,
  computeSaleCost,
  quoteAnticipation,
  splitFranchiseSale,
} from './fees'

describe('computeSaleCost', () => {
  it('crédito 1x R$100 com 2.99% → fee R$2.99 + net R$97.01', () => {
    const r = computeSaleCost({
      grossAmountCents: 10_000,
      cardKind: 'credit',
      installments: 1,
      feeRatePct: 2.99,
    })
    expect(r.percentFeeCents).toBe(299)
    expect(r.flatFeeCents).toBe(0)
    expect(r.totalFeeCents).toBe(299)
    expect(r.netCents).toBe(9701)
    expect(r.netMarginPct).toBeCloseTo(97.01, 2)
  })

  it('com tarifa fixa adicional R$0.20', () => {
    const r = computeSaleCost({
      grossAmountCents: 10_000,
      cardKind: 'credit',
      installments: 1,
      feeRatePct: 2.99,
      flatFeeCents: 20,
    })
    expect(r.totalFeeCents).toBe(319)
    expect(r.netCents).toBe(9681)
  })

  it('net = gross - totalFee garantido (consistente com check constraint)', () => {
    const r = computeSaleCost({
      grossAmountCents: 50_000,
      cardKind: 'credit',
      installments: 6,
      feeRatePct: 3.95,
      flatFeeCents: 40,
    })
    expect(r.netCents).toBe(r.grossCents - r.totalFeeCents)
  })

  it('gross 0 → margem 0% sem dividir por zero', () => {
    const r = computeSaleCost({
      grossAmountCents: 0,
      cardKind: 'pix',
      installments: 1,
      feeRatePct: 0.99,
    })
    expect(r.netMarginPct).toBe(0)
  })
})

describe('quoteAnticipation', () => {
  it('30 dias × 1.99% = 1.99% (rate mensal completo)', () => {
    const r = quoteAnticipation({
      originalAmountCents: 100_000,
      daysToOriginalSettlement: 30,
    })
    expect(r.effectiveRatePct).toBe('1.99')
    expect(r.feeCents).toBe(1990)
    expect(r.anticipatedCents).toBe(98010)
    expect(r.daysSaved).toBe(30)
  })

  it('15 dias × 1.99% = ~0.995% (truncado a 2 casas)', () => {
    const r = quoteAnticipation({
      originalAmountCents: 100_000,
      daysToOriginalSettlement: 15,
    })
    // toFixed(2) arredonda 0.995 → "0.99" (banker's rounding em alguns runtimes)
    expect(Number(r.effectiveRatePct)).toBeGreaterThanOrEqual(0.99)
    expect(Number(r.effectiveRatePct)).toBeLessThanOrEqual(1.0)
    expect(r.feeCents).toBe(995)
  })

  it('dias negativos clampam pra 0 (settlement passado)', () => {
    const r = quoteAnticipation({
      originalAmountCents: 100_000,
      daysToOriginalSettlement: -5,
    })
    expect(r.feeCents).toBe(0)
    expect(r.anticipatedCents).toBe(100_000)
  })

  it('taxa customizada (3% a.m.) é respeitada', () => {
    const r = quoteAnticipation({
      originalAmountCents: 100_000,
      daysToOriginalSettlement: 30,
      monthlyRatePct: 3.0,
    })
    expect(r.feeCents).toBe(3000)
  })
})

describe('splitFranchiseSale', () => {
  const FRANCHISOR = '11111111-1111-1111-1111-111111111111'
  const FRANCHISEE_A = '22222222-2222-2222-2222-222222222222'
  const FRANCHISEE_B = '33333333-3333-3333-3333-333333333333'

  const agreement: FranchiseAgreement = {
    id: '00000000-0000-0000-0000-000000000001',
    franchisorCompanyId: FRANCHISOR,
    franchiseeCompanyId: FRANCHISEE_A,
    royaltyPct: 5,
    marketingPct: 2,
    active: true,
  }

  it('split com royalty 5% + marketing 2% gera 2 entries', () => {
    const entries = splitFranchiseSale({
      netAmountCents: 100_000,
      capturedAtCompanyId: FRANCHISEE_A,
      agreements: [agreement],
      saleDescription: 'Venda CC visa NSU-100',
    })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      fromCompanyId: FRANCHISEE_A,
      toCompanyId: FRANCHISOR,
      amountCents: 5000,
      kind: 'royalty',
    })
    expect(entries[1]).toMatchObject({
      fromCompanyId: FRANCHISEE_A,
      toCompanyId: FRANCHISOR,
      amountCents: 2000,
      kind: 'marketing',
    })
  })

  it('split com marketing 0% gera só royalty', () => {
    const noMkt: FranchiseAgreement = { ...agreement, marketingPct: 0 }
    const entries = splitFranchiseSale({
      netAmountCents: 100_000,
      capturedAtCompanyId: FRANCHISEE_A,
      agreements: [noMkt],
      saleDescription: 'venda',
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('royalty')
  })

  it('split em company sem acordo retorna vazio', () => {
    const entries = splitFranchiseSale({
      netAmountCents: 100_000,
      capturedAtCompanyId: FRANCHISEE_B,
      agreements: [agreement],
      saleDescription: 'venda',
    })
    expect(entries).toHaveLength(0)
  })

  it('acordo inativo é ignorado', () => {
    const inactive: FranchiseAgreement = { ...agreement, active: false }
    const entries = splitFranchiseSale({
      netAmountCents: 100_000,
      capturedAtCompanyId: FRANCHISEE_A,
      agreements: [inactive],
      saleDescription: 'venda',
    })
    expect(entries).toHaveLength(0)
  })

  it('valor arredondado ao centavo mais próximo', () => {
    const entries = splitFranchiseSale({
      netAmountCents: 33333,
      capturedAtCompanyId: FRANCHISEE_A,
      agreements: [{ ...agreement, royaltyPct: 7.5, marketingPct: 0 }],
      saleDescription: 'venda',
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.amountCents).toBe(Math.round(33333 * 0.075)) // 2500
  })
})
