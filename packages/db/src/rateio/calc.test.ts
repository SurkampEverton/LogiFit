/**
 * Calculator de rateio — Sprint 16 Faixa B.
 *
 * Cobre: fixed/proportional/per_unit/by_revenue/by_headcount/custom +
 * arredondamento exato (sum bate com amount) + validação de distribution.
 */
import { describe, expect, it } from 'vitest'
import { distribute, validateRuleDistribution } from './calc'

const C_A = '11111111-1111-1111-1111-111111111111'
const C_B = '22222222-2222-2222-2222-222222222222'
const C_C = '33333333-3333-3333-3333-333333333333'

describe('distribute() — fixed', () => {
  it('rateio 40/30/30 sobre R$ 10.000', () => {
    const r = distribute({
      amountCents: 1_000_000,
      rule: {
        kind: 'fixed',
        distribution: [
          { companyId: C_A, percent: 40 },
          { companyId: C_B, percent: 30 },
          { companyId: C_C, percent: 30 },
        ],
      },
    })
    expect(r.allocations).toHaveLength(3)
    expect(r.allocations[0]!.amountCents).toBe(400_000)
    expect(r.allocations[1]!.amountCents).toBe(300_000)
    expect(r.allocations[2]!.amountCents).toBe(300_000)
    // Soma bate com input
    expect(r.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(1_000_000)
  })

  it('rateio 1/3 1/3 1/3 com resto (R$ 100,01)', () => {
    const r = distribute({
      amountCents: 10001,
      rule: {
        kind: 'fixed',
        distribution: [
          { companyId: C_A, percent: 33.3333 },
          { companyId: C_B, percent: 33.3333 },
          { companyId: C_C, percent: 33.3334 }, // ajustado pra somar 100
        ],
      },
    })
    // Soma exata (resto vai pra última)
    expect(r.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(10001)
  })

  it('soma de percent != 100 rejeitada', () => {
    expect(() =>
      distribute({
        amountCents: 1_000_000,
        rule: {
          kind: 'fixed',
          distribution: [
            { companyId: C_A, percent: 40 },
            { companyId: C_B, percent: 30 },
          ],
        },
      }),
    ).toThrow(/100/)
  })
})

describe('distribute() — proportional', () => {
  it('weights 2:1:1 sobre R$ 100', () => {
    const r = distribute({
      amountCents: 10000,
      rule: {
        kind: 'proportional',
        distribution: [
          { companyId: C_A, weight: 2 },
          { companyId: C_B, weight: 1 },
          { companyId: C_C, weight: 1 },
        ],
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(5000) // 50%
    expect(r.allocations[1]!.amountCents).toBe(2500) // 25%
    expect(r.allocations[2]!.amountCents).toBe(2500) // 25%
    expect(r.allocations[0]!.percentApplied).toBe(50)
    expect(r.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(10000)
  })

  it('weights zero retorna vazio', () => {
    const r = distribute({
      amountCents: 10000,
      rule: {
        kind: 'proportional',
        distribution: [
          { companyId: C_A, weight: 0 },
          { companyId: C_B, weight: 0 },
        ],
      },
    })
    expect(r.allocations).toHaveLength(0)
  })
})

describe('distribute() — per_unit', () => {
  it('matriz com 3 unidades + filial com 1 = 75/25', () => {
    const r = distribute({
      amountCents: 100_000,
      rule: {
        kind: 'per_unit',
        distribution: [{ companyId: C_A }, { companyId: C_B }],
      },
      context: {
        unitsByCompany: { [C_A]: 3, [C_B]: 1 },
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(75_000)
    expect(r.allocations[1]!.amountCents).toBe(25_000)
    expect(r.contextSnapshot).toEqual({ unitsByCompany: { [C_A]: 3, [C_B]: 1 } })
  })

  it('company sem units recebe 0', () => {
    const r = distribute({
      amountCents: 100_000,
      rule: {
        kind: 'per_unit',
        distribution: [{ companyId: C_A }, { companyId: C_B }],
      },
      context: {
        unitsByCompany: { [C_A]: 2 },
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(100_000)
    expect(r.allocations[1]!.amountCents).toBe(0)
  })
})

describe('distribute() — by_revenue', () => {
  it('proporcional ao revenue do mês', () => {
    const r = distribute({
      amountCents: 500_000,
      rule: {
        kind: 'by_revenue',
        distribution: [{ companyId: C_A }, { companyId: C_B }],
      },
      context: {
        revenueByCompany: { [C_A]: 30_000_000, [C_B]: 20_000_000 },
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(300_000) // 60%
    expect(r.allocations[1]!.amountCents).toBe(200_000) // 40%
    expect(r.contextSnapshot?.revenueByCompany).toBeDefined()
  })
})

describe('distribute() — by_headcount', () => {
  it('proporcional ao headcount', () => {
    const r = distribute({
      amountCents: 600_000,
      rule: {
        kind: 'by_headcount',
        distribution: [{ companyId: C_A }, { companyId: C_B }, { companyId: C_C }],
      },
      context: {
        headcountByCompany: { [C_A]: 10, [C_B]: 5, [C_C]: 5 },
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(300_000) // 50%
    expect(r.allocations[1]!.amountCents).toBe(150_000) // 25%
    expect(r.allocations[2]!.amountCents).toBe(150_000) // 25%
  })
})

describe('distribute() — custom', () => {
  it('custom é alias de fixed com soma=100', () => {
    const r = distribute({
      amountCents: 100_000,
      rule: {
        kind: 'custom',
        distribution: [
          { companyId: C_A, percent: 70 },
          { companyId: C_B, percent: 30 },
        ],
      },
    })
    expect(r.allocations[0]!.amountCents).toBe(70_000)
    expect(r.allocations[1]!.amountCents).toBe(30_000)
  })
})

describe('distribute() — edge cases', () => {
  it('amount=0 retorna vazio', () => {
    const r = distribute({
      amountCents: 0,
      rule: {
        kind: 'fixed',
        distribution: [{ companyId: C_A, percent: 100 }],
      },
    })
    expect(r.allocations).toHaveLength(0)
  })

  it('1 cent rateado 50/50 — primeira pega 0, última pega 1', () => {
    const r = distribute({
      amountCents: 1,
      rule: {
        kind: 'fixed',
        distribution: [
          { companyId: C_A, percent: 50 },
          { companyId: C_B, percent: 50 },
        ],
      },
    })
    // 0.5 → round = 1 + última = 0 (ou 0 + 1 dependendo da ordem)
    expect(r.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(1)
  })
})

describe('validateRuleDistribution()', () => {
  it('fixed válida', () => {
    expect(
      validateRuleDistribution('fixed', [
        { companyId: C_A, percent: 60 },
        { companyId: C_B, percent: 40 },
      ]),
    ).toEqual({ ok: true })
  })

  it('fixed soma != 100 inválida', () => {
    const r = validateRuleDistribution('fixed', [
      { companyId: C_A, percent: 50 },
      { companyId: C_B, percent: 40 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/100/)
  })

  it('proportional weights todos zero inválida', () => {
    const r = validateRuleDistribution('proportional', [
      { companyId: C_A, weight: 0 },
      { companyId: C_B, weight: 0 },
    ])
    expect(r.ok).toBe(false)
  })

  it('per_unit válida', () => {
    expect(validateRuleDistribution('per_unit', [{ companyId: C_A }, { companyId: C_B }])).toEqual({
      ok: true,
    })
  })

  it('lista vazia inválida', () => {
    expect(validateRuleDistribution('fixed', []).ok).toBe(false)
  })

  it('mais de 20 companies inválido', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      companyId: `${i.toString().padStart(8, '0')}-1111-1111-1111-111111111111`,
      percent: 100 / 21,
    }))
    expect(validateRuleDistribution('fixed', many).ok).toBe(false)
  })
})
