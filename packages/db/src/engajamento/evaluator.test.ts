/**
 * Engajamento — evaluator unit tests (Sprint 09 Faixa B).
 */
import { describe, expect, it } from 'vitest'
import {
  type MemberContext,
  evaluateRule,
  parseRuleJsonb,
} from './evaluator'

function emptyCtx(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    memberId: 'test-member',
    checkinCounts: new Map(),
    paymentStreakMonths: 0,
    goalsReachedByKind: new Map(),
    tenureDays: 0,
    referralConvertedCount: 0,
    ...overrides,
  }
}

describe('evaluateRule — checkin_count', () => {
  it('target atingido com window específica', () => {
    const r = evaluateRule(
      { kind: 'checkin_count', params: { target: 10, within_days: 7 } },
      emptyCtx({ checkinCounts: new Map([[7, 12]]) }),
    )
    expect(r.matched).toBe(true)
    expect(r.progress.percent).toBe(100)
  })

  it('target não atingido — progresso parcial', () => {
    const r = evaluateRule(
      { kind: 'checkin_count', params: { target: 50, within_days: null } },
      emptyCtx({ checkinCounts: new Map([['all', 25]]) }),
    )
    expect(r.matched).toBe(false)
    expect(r.progress.percent).toBe(50)
  })

  it('window com 0 check-ins → progress 0%', () => {
    const r = evaluateRule(
      { kind: 'checkin_count', params: { target: 10, within_days: 7 } },
      emptyCtx(),
    )
    expect(r.matched).toBe(false)
    expect(r.progress.current).toBe(0)
  })
})

describe('evaluateRule — payment_streak', () => {
  it('streak 12m bate target 12', () => {
    const r = evaluateRule(
      { kind: 'payment_streak', params: { months: 12 } },
      emptyCtx({ paymentStreakMonths: 12 }),
    )
    expect(r.matched).toBe(true)
  })

  it('streak 6m com target 12 → 50%', () => {
    const r = evaluateRule(
      { kind: 'payment_streak', params: { months: 12 } },
      emptyCtx({ paymentStreakMonths: 6 }),
    )
    expect(r.matched).toBe(false)
    expect(r.progress.percent).toBe(50)
  })
})

describe('evaluateRule — goal_reached', () => {
  it('1 goal weight_loss reached + target=1 → match', () => {
    const r = evaluateRule(
      { kind: 'goal_reached', params: { goal_kind: 'weight_loss', count: 1 } },
      emptyCtx({ goalsReachedByKind: new Map([['weight_loss', 1]]) }),
    )
    expect(r.matched).toBe(true)
  })

  it('sem goal_kind → conta total (all)', () => {
    const r = evaluateRule(
      { kind: 'goal_reached', params: { count: 3 } },
      emptyCtx({ goalsReachedByKind: new Map([['all', 5]]) }),
    )
    expect(r.matched).toBe(true)
  })
})

describe('evaluateRule — tenure_days', () => {
  it('365 dias bate "1 ano"', () => {
    const r = evaluateRule(
      { kind: 'tenure_days', params: { target: 365 } },
      emptyCtx({ tenureDays: 380 }),
    )
    expect(r.matched).toBe(true)
  })

  it('member recente (30d) com target 365 → 8%', () => {
    const r = evaluateRule(
      { kind: 'tenure_days', params: { target: 365 } },
      emptyCtx({ tenureDays: 30 }),
    )
    expect(r.matched).toBe(false)
    expect(r.progress.percent).toBe(8)
  })
})

describe('evaluateRule — referral_count', () => {
  it('3 referrals + target 3 → match', () => {
    const r = evaluateRule(
      { kind: 'referral_count', params: { target: 3 } },
      emptyCtx({ referralConvertedCount: 3 }),
    )
    expect(r.matched).toBe(true)
  })
})

describe('parseRuleJsonb', () => {
  it('parse válido com kind=checkin_count', () => {
    const parsed = parseRuleJsonb({
      kind: 'checkin_count',
      params: { target: 10, within_days: 30 },
    })
    expect(parsed?.kind).toBe('checkin_count')
  })

  it('parse retorna null se kind inválido', () => {
    const parsed = parseRuleJsonb({ kind: 'invalid_kind', params: {} })
    expect(parsed).toBeNull()
  })

  it('parse retorna null se params faltam target', () => {
    const parsed = parseRuleJsonb({ kind: 'checkin_count', params: {} })
    expect(parsed).toBeNull()
  })

  it('parse retorna null se input não é objeto', () => {
    expect(parseRuleJsonb(null)).toBeNull()
    expect(parseRuleJsonb('string')).toBeNull()
  })
})
