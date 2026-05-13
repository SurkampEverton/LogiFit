/**
 * Cotas mensais por plano (ADR 0066 + ADR 0064) — Sprint 06 Faixa B.
 *
 * 1 chamada = 1 invocação `resolveModelForTask()` que NÃO seja cache hit.
 * Cache hit Camada 1 = 0 chamadas. Tool execution não conta (regra 36 cobre).
 *
 * Soft daily cap = 1/10 do mensal (toast informativo, não bloqueia).
 * Mensal excedido = circuit breaker + CTA "Configure BYOK ou upgrade".
 */
import type { TenantContext } from './types'

export const AI_PLAN_LIMITS = {
  solo: { monthly: 200, dailySoft: 20 },
  solo_combo: { monthly: 200, dailySoft: 20 },
  starter: { monthly: 500, dailySoft: 50 },
  pro: { monthly: 3000, dailySoft: 150 },
  business: { monthly: 10_000, dailySoft: 500 },
  enterprise: { monthly: 25_000, dailySoft: 1500 },
} as const

export type AIQuotaPlan = keyof typeof AI_PLAN_LIMITS

export interface QuotaSnapshot {
  monthly: { used: number; limit: number; percent: number }
  daily: { used: number; soft: number; warn: boolean }
  /** Hard-stop ativo. */
  blocked: boolean
  /** Soft daily atingido — toast, não bloqueia. */
  softWarning: boolean
}

export function getPlanLimits(tier: AIQuotaPlan): { monthly: number; dailySoft: number } {
  return AI_PLAN_LIMITS[tier]
}

/**
 * Verifica se nova chamada cabe na cota.
 *
 * @returns snapshot + decisão de bloqueio. BYOK ativo bypassa (caller checa
 * antes de chamar isso).
 */
export function checkQuota(
  tenantCtx: TenantContext,
  current: { monthlyUsed: number; dailyUsed: number },
): QuotaSnapshot {
  const limits = getPlanLimits(tenantCtx.planTier)
  const monthlyPercent = limits.monthly === 0 ? 0 : (current.monthlyUsed / limits.monthly) * 100
  return {
    monthly: {
      used: current.monthlyUsed,
      limit: limits.monthly,
      percent: Math.min(monthlyPercent, 100),
    },
    daily: {
      used: current.dailyUsed,
      soft: limits.dailySoft,
      warn: current.dailyUsed >= limits.dailySoft,
    },
    blocked: current.monthlyUsed >= limits.monthly,
    softWarning: current.dailyUsed >= limits.dailySoft,
  }
}
