/**
 * Tabela canônica de rate limits (regra 36 + ADR 0073).
 *
 * Sprint 00: tabela de regras + tipos + stub no-op. Implementação real (Redis
 * sliding window via lib `rate-limiter-flexible` ou Lua script) chega na
 * Faixa 3 quando container Redis estiver acessível e wrapAction (ADR 0071)
 * integrar via `ctx.rateLimitKey`.
 */

export interface RateLimitRule {
  /** Número máximo de requests no window. */
  max: number
  /** Janela em ms. */
  windowMs: number
  /** Eixo da chave: ip / user / email / tenant — combinados por endpoint. */
  axis: ReadonlyArray<'ip' | 'user' | 'email' | 'tenant'>
}

export const RATE_LIMITS = {
  // Auth (regra 36)
  loginByIp: { max: 10, windowMs: 15 * 60_000, axis: ['ip'] as const },
  loginByEmail: { max: 5, windowMs: 15 * 60_000, axis: ['email'] as const },
  signupByIp: { max: 3, windowMs: 60 * 60_000, axis: ['ip'] as const },

  // App
  read: { max: 100, windowMs: 60_000, axis: ['user', 'tenant'] as const },
  write: { max: 30, windowMs: 60_000, axis: ['user', 'tenant'] as const },
  search: { max: 30, windowMs: 60_000, axis: ['user', 'tenant'] as const },
  ai: { max: 20, windowMs: 60_000, axis: ['user', 'tenant'] as const },

  // Webhook entrada
  webhookByIp: { max: 60, windowMs: 60_000, axis: ['ip'] as const },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitName = keyof typeof RATE_LIMITS

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  resetMs: number
}

/**
 * Stub no-op até Faixa 3. Implementação real consulta Redis via sliding window;
 * wrapAction lê ctx.rateLimitKey, monta chave `(tenant, user|ip, endpoint)`,
 * chama checkRateLimit, retorna RATE_LIMITED se !allowed (com retry_after_ms).
 */
export async function checkRateLimit(
  _name: RateLimitName,
  _key: string,
): Promise<RateLimitDecision> {
  return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetMs: 0 }
}
