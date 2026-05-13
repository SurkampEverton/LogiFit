import { describe, expect, it } from 'vitest'
import { checkQuota, getPlanLimits } from './quotas'
import type { TenantContext } from './types'

const ctx = (tier: TenantContext['planTier']): TenantContext => ({
  tenantId: 't',
  userId: 'u',
  planTier: tier,
  locale: 'pt-BR',
})

describe('getPlanLimits', () => {
  it('starter 500/50', () => {
    expect(getPlanLimits('starter')).toEqual({ monthly: 500, dailySoft: 50 })
  })
  it('pro 3k/150', () => {
    expect(getPlanLimits('pro')).toEqual({ monthly: 3000, dailySoft: 150 })
  })
  it('business 10k/500', () => {
    expect(getPlanLimits('business')).toEqual({ monthly: 10000, dailySoft: 500 })
  })
  it('enterprise 25k/1500', () => {
    expect(getPlanLimits('enterprise')).toEqual({ monthly: 25000, dailySoft: 1500 })
  })
  it('solo 200/20', () => {
    expect(getPlanLimits('solo')).toEqual({ monthly: 200, dailySoft: 20 })
  })
})

describe('checkQuota', () => {
  it('starter 100/500 mensal não bloqueia', () => {
    const r = checkQuota(ctx('starter'), { monthlyUsed: 100, dailyUsed: 5 })
    expect(r.blocked).toBe(false)
    expect(r.softWarning).toBe(false)
    expect(r.monthly.percent).toBe(20)
  })

  it('starter 500/500 mensal bloqueia', () => {
    const r = checkQuota(ctx('starter'), { monthlyUsed: 500, dailyUsed: 50 })
    expect(r.blocked).toBe(true)
  })

  it('starter 50/50 soft cap warn (não bloqueia mensal)', () => {
    const r = checkQuota(ctx('starter'), { monthlyUsed: 200, dailyUsed: 50 })
    expect(r.blocked).toBe(false)
    expect(r.softWarning).toBe(true)
    expect(r.daily.warn).toBe(true)
  })

  it('starter mensal hard-stop ignora daily warn', () => {
    const r = checkQuota(ctx('starter'), { monthlyUsed: 501, dailyUsed: 51 })
    expect(r.blocked).toBe(true)
    expect(r.monthly.percent).toBe(100)
  })
})
