/**
 * predict.ts tests — Sprint 19 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import type { ChurnFeatures } from './features'
import { bandFromProb, heuristicPredict, predictChurn } from './predict'

const STABLE: ChurnFeatures = {
  frequencyLast30d: 12,
  frequencyPrev30d: 14,
  frequencyChangePct: -14.3,
  daysSinceLastCheckin: 2,
  overdueInvoicesCount: 0,
  overdueTotalCents: 0,
  monthsAsMember: 18,
  avgTicketCents: 18900,
  achievementsEarned90d: 4,
  goalsActiveCount: 2,
  lastPlanChangeAt: null,
  planChangedDowngrade: false,
}

const HIGH_RISK: ChurnFeatures = {
  frequencyLast30d: 1,
  frequencyPrev30d: 10,
  frequencyChangePct: -90,
  daysSinceLastCheckin: 35,
  overdueInvoicesCount: 2,
  overdueTotalCents: 37800,
  monthsAsMember: 5,
  avgTicketCents: 18900,
  achievementsEarned90d: 0,
  goalsActiveCount: 0,
  lastPlanChangeAt: '2026-04-01',
  planChangedDowngrade: true,
}

describe('bandFromProb', () => {
  it('limites de banda', () => {
    expect(bandFromProb(0)).toBe('low')
    expect(bandFromProb(0.299)).toBe('low')
    expect(bandFromProb(0.3)).toBe('medium')
    expect(bandFromProb(0.59)).toBe('medium')
    expect(bandFromProb(0.6)).toBe('high')
    expect(bandFromProb(1)).toBe('high')
  })
})

describe('heuristicPredict', () => {
  it('member estável → riskBand low + prob_30d baixa', () => {
    const r = heuristicPredict(STABLE)
    expect(r.riskBand).toBe('low')
    expect(r.prob30d).toBeLessThan(0.3)
    expect(r.source).toBe('heuristic')
    expect(r.topFactors.length).toBeGreaterThanOrEqual(1)
  })

  it('member em alto risco → riskBand high + prob_30d ≥ 0.6', () => {
    const r = heuristicPredict(HIGH_RISK)
    expect(r.riskBand).toBe('high')
    expect(r.prob30d).toBeGreaterThanOrEqual(0.6)
    expect(r.topFactors.some((f) => f.factor === 'long_absence')).toBe(true)
    expect(r.topFactors.some((f) => f.factor === 'frequency_drop')).toBe(true)
  })

  it('probs respeitam invariante: prob_30d ≤ prob_60d ≤ prob_90d', () => {
    const r = heuristicPredict(HIGH_RISK)
    expect(r.prob30d).toBeLessThanOrEqual(r.prob60d)
    expect(r.prob60d).toBeLessThanOrEqual(r.prob90d)
  })

  it('engajamento ativo reduz score', () => {
    const f: ChurnFeatures = {
      ...HIGH_RISK,
      achievementsEarned90d: 5,
      goalsActiveCount: 3,
    }
    const rEngajado = heuristicPredict(f)
    const rSemEngajamento = heuristicPredict(HIGH_RISK)
    expect(rEngajado.prob30d).toBeLessThan(rSemEngajamento.prob30d)
  })

  it('loyalty buff aplica em member 12m+ com risco médio', () => {
    const f: ChurnFeatures = {
      ...HIGH_RISK,
      monthsAsMember: 24,
    }
    const r = heuristicPredict(f)
    expect(r.topFactors.some((x) => x.factor === 'loyalty')).toBe(true)
  })

  it('probs sempre clamp [0, 1]', () => {
    const extreme: ChurnFeatures = {
      ...HIGH_RISK,
      daysSinceLastCheckin: 999,
      overdueInvoicesCount: 99,
      frequencyChangePct: -100,
    }
    const r = heuristicPredict(extreme)
    expect(r.prob30d).toBeLessThanOrEqual(1)
    expect(r.prob30d).toBeGreaterThanOrEqual(0)
    expect(r.prob90d).toBeLessThanOrEqual(1)
  })

  it('member novo sem check-in mas <2m: não dispara never_checkin', () => {
    const f: ChurnFeatures = {
      ...STABLE,
      daysSinceLastCheckin: -1,
      monthsAsMember: 1,
    }
    const r = heuristicPredict(f)
    expect(r.topFactors.some((x) => x.factor === 'never_checkin')).toBe(false)
  })

  it('member 3m sem nenhum check-in: dispara never_checkin', () => {
    const f: ChurnFeatures = {
      ...STABLE,
      daysSinceLastCheckin: -1,
      monthsAsMember: 3,
    }
    const r = heuristicPredict(f)
    expect(r.topFactors.some((x) => x.factor === 'never_checkin')).toBe(true)
  })
})

describe('predictChurn — LLM com fallback', () => {
  it('sem callback → usa heurística', async () => {
    const r = await predictChurn(STABLE)
    expect(r.source).toBe('heuristic')
  })

  it('com callback válido → usa LLM', async () => {
    const r = await predictChurn(STABLE, async () => ({
      prob30d: 0.42,
      prob60d: 0.5,
      prob90d: 0.55,
      topFactors: [{ factor: 'llm_factor', weight: 0.3, narrative: 'IA disse algo' }],
    }))
    expect(r.source).toBe('llm')
    expect(r.prob30d).toBe(0.42)
    expect(r.riskBand).toBe('medium')
  })

  it('LLM retorna prob fora de [0,1] → fallback heurística', async () => {
    const r = await predictChurn(STABLE, async () => ({
      prob30d: 1.5, // inválido
      prob60d: 0.5,
      prob90d: 0.55,
      topFactors: [{ factor: 'bug', weight: 0.5, narrative: 'overflow' }],
    }))
    expect(r.source).toBe('heuristic')
  })

  it('LLM throw → fallback heurística', async () => {
    const r = await predictChurn(STABLE, async () => {
      throw new Error('Network timeout')
    })
    expect(r.source).toBe('heuristic')
  })
})
