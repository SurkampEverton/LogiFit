/**
 * features.ts tests — Sprint 19 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import { computeFeatures, hashFeatures } from './features'

const FIXED_DATE = new Date('2026-05-17T12:00:00Z')

describe('computeFeatures', () => {
  it('member ativo sem overdue → baseline limpo', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [
        '2026-05-15T18:00:00Z', // 2 dias atrás
        '2026-05-12T18:00:00Z',
        '2026-05-10T18:00:00Z',
      ],
      invoices: [
        { status: 'paid', amountCents: 18900, dueDate: '2026-05-01', paidAt: '2026-05-01T10:00:00Z' },
      ],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    expect(f.frequencyLast30d).toBe(3)
    expect(f.frequencyPrev30d).toBe(0)
    expect(f.daysSinceLastCheckin).toBe(1) // floor((42h)/24h) = 1
    expect(f.overdueInvoicesCount).toBe(0)
    expect(f.avgTicketCents).toBe(18900)
    expect(f.monthsAsMember).toBe(5)
  })

  it('member em risco: 30 dias sem check-in + overdue', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [
        '2026-04-10T18:00:00Z', // ~37 dias atrás
        '2026-03-15T18:00:00Z', // 63 dias atrás (fora do prev30 também)
      ],
      invoices: [
        { status: 'overdue', amountCents: 18900, dueDate: '2026-04-15' },
        { status: 'overdue', amountCents: 18900, dueDate: '2026-05-01' },
      ],
      contractStartedAt: '2025-08-01T00:00:00Z',
    })
    expect(f.frequencyLast30d).toBe(0)
    expect(f.daysSinceLastCheckin).toBeGreaterThanOrEqual(30)
    expect(f.overdueInvoicesCount).toBe(2)
    expect(f.overdueTotalCents).toBe(37800)
  })

  it('variação % calculada corretamente (queda 50%)', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [
        // last30: 2 visitas
        '2026-05-15T18:00:00Z',
        '2026-05-01T18:00:00Z',
        // prev30 (31-60 dias): 4 visitas
        '2026-04-15T18:00:00Z',
        '2026-04-10T18:00:00Z',
        '2026-04-05T18:00:00Z',
        '2026-04-01T18:00:00Z',
      ],
      invoices: [],
      contractStartedAt: '2025-01-01T00:00:00Z',
    })
    expect(f.frequencyLast30d).toBe(2)
    expect(f.frequencyPrev30d).toBe(4)
    expect(f.frequencyChangePct).toBe(-50)
  })

  it('prev30=0 e last30>0 → 100% growth', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: ['2026-05-15T18:00:00Z'],
      invoices: [],
      contractStartedAt: '2026-04-15T00:00:00Z',
    })
    expect(f.frequencyChangePct).toBe(100)
  })

  it('nunca checkou → daysSinceLastCheckin = -1', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [],
      invoices: [],
      contractStartedAt: '2026-04-01T00:00:00Z',
    })
    expect(f.daysSinceLastCheckin).toBe(-1)
  })

  it('ticket médio ignora invoices fora dos últimos 6 meses', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [],
      invoices: [
        // dentro de 6m: 3 invoices
        { status: 'paid', amountCents: 10000, dueDate: '2026-03-01', paidAt: '2026-03-01T00:00:00Z' },
        { status: 'paid', amountCents: 20000, dueDate: '2026-04-01', paidAt: '2026-04-01T00:00:00Z' },
        { status: 'paid', amountCents: 30000, dueDate: '2026-05-01', paidAt: '2026-05-01T00:00:00Z' },
        // fora de 6m (devia ignorar)
        { status: 'paid', amountCents: 99999, dueDate: '2024-01-01', paidAt: '2024-01-01T00:00:00Z' },
      ],
      contractStartedAt: '2024-01-01T00:00:00Z',
    })
    expect(f.avgTicketCents).toBe(20000) // (10k+20k+30k)/3
  })

  it('monthsAsMember = 0 quando contractStartedAt > asOf', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [],
      invoices: [],
      contractStartedAt: '2027-01-01T00:00:00Z',
    })
    expect(f.monthsAsMember).toBe(0)
  })
})

describe('hashFeatures', () => {
  it('mesmas features = mesmo hash', () => {
    const f1 = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: ['2026-05-15T18:00:00Z'],
      invoices: [],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    const f2 = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: ['2026-05-15T18:00:00Z'],
      invoices: [],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    expect(hashFeatures(f1)).toBe(hashFeatures(f2))
  })

  it('features diferentes = hashes diferentes', () => {
    const fA = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: ['2026-05-15T18:00:00Z'],
      invoices: [],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    const fB = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: ['2026-05-10T18:00:00Z'],
      invoices: [],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    expect(hashFeatures(fA)).not.toBe(hashFeatures(fB))
  })

  it('hash é hex sha256 (64 chars)', () => {
    const f = computeFeatures({
      asOf: FIXED_DATE,
      checkInDates: [],
      invoices: [],
      contractStartedAt: '2025-12-01T00:00:00Z',
    })
    const h = hashFeatures(f)
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })
})
