/**
 * Magic Link — Sprint 26 Faixa B.1.
 *
 * Geração de tokens random + hashing SHA-256 + validação de TTL + anti-enumeration.
 *
 * **Crypto**: Node usa `node:crypto`. Browser usa Web Crypto API (`crypto.subtle.digest`).
 * Esta lib é pura (testável sem DB); o Server Action (Faixa B.2) chama o gerador
 * e persiste hash.
 *
 * **Anti-enumeration** — resposta de `requestMagicLink` é SEMPRE ok, mesmo se
 * email não existe. Atraso constante (200-500ms aleatório) pra impedir timing
 * attack. Implementado em `prepareEnumerationResistantResponse`.
 *
 * **Rate limit** — `shouldRateLimit` é a regra pura; Server Action consulta
 * tabela `auth_attempts` (Sprint 01a) ou Redis pra contagem.
 */
import crypto from 'node:crypto'

// ─── Token gen + hash ────────────────────────────────────────────────────

/** TTL default: 15 minutos (ADR 0088). */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000

/** Sessão member default: 30 dias (ADR 0088). */
export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Min entre solicitações de magic link pro mesmo email (rate limit). */
export const MAGIC_LINK_THROTTLE_SECONDS = 60

/** Máx solicitações de magic link por email em 15min (anti-flood). */
export const MAGIC_LINK_MAX_PER_WINDOW = 5

/** Janela de rate limit em segundos. */
export const MAGIC_LINK_WINDOW_SECONDS = 15 * 60

export interface GeneratedMagicLink {
  /** Token plano — vai no email/SMS (URL-safe base64url, 32 bytes = 256 bits). */
  token: string
  /** SHA-256 do token plano — vai no banco. */
  tokenHash: string
  /** ISO timestamp de expiração. */
  expiresAt: string
}

/**
 * Gera magic link: random 32 bytes → base64url → SHA-256(hash).
 *
 * Token plano nunca volta a entrar no fluxo após persistido (single-use).
 */
export function generateMagicLink(now: Date = new Date()): GeneratedMagicLink {
  const tokenBytes = crypto.randomBytes(32)
  const token = tokenBytes.toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString()
  return { token, tokenHash, expiresAt }
}

/**
 * Hash de token plano (verify lado servidor). Mesmo algoritmo de `generateMagicLink`.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// ─── Refresh token (member_sessions) ─────────────────────────────────────

export interface GeneratedRefreshToken {
  token: string
  tokenHash: string
  expiresAt: string
}

/**
 * Gera refresh token de sessão member — TTL 30d. Mesmo esquema do magic link
 * (random 32 bytes + SHA-256), só muda o TTL.
 */
export function generateRefreshToken(now: Date = new Date()): GeneratedRefreshToken {
  const tokenBytes = crypto.randomBytes(32)
  const token = tokenBytes.toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_MS).toISOString()
  return { token, tokenHash, expiresAt }
}

// ─── Verify TTL ──────────────────────────────────────────────────────────

export type MagicLinkVerifyResult =
  | { ok: true; tokenHash: string }
  | { ok: false; reason: 'expired' | 'used' | 'invalid_format' }

export interface PersistedTokenRow {
  tokenHash: string
  expiresAt: string
  usedAt: string | null
}

/**
 * Verifica token contra row persistida.
 *   - reason='used' se usedAt != null
 *   - reason='expired' se now > expiresAt
 *   - ok=true caso contrário
 */
export function verifyMagicLinkAgainstRow(
  tokenPlain: string,
  row: PersistedTokenRow,
  now: Date = new Date(),
): MagicLinkVerifyResult {
  if (!tokenPlain || tokenPlain.length < 8) {
    return { ok: false, reason: 'invalid_format' }
  }
  const computedHash = hashToken(tokenPlain)
  if (computedHash !== row.tokenHash) {
    return { ok: false, reason: 'invalid_format' }
  }
  if (row.usedAt) {
    return { ok: false, reason: 'used' }
  }
  if (now.getTime() > new Date(row.expiresAt).getTime()) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, tokenHash: computedHash }
}

// ─── Anti-enumeration + rate limit ───────────────────────────────────────

export interface RateLimitInput {
  /** Quantidade de requests dentro da janela atual */
  requestCount: number
  /** Segundos desde a última request (null = nunca solicitou) */
  secondsSinceLast: number | null
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
  reason?: 'throttle' | 'max_per_window'
}

/**
 * Decide se nova request de magic link deve ser aceita.
 *   - bloqueia se < 60s desde a última (throttle)
 *   - bloqueia se ≥ 5 requests em 15min (anti-flood)
 *
 * **Importante:** mesmo bloqueado, Server Action deve retornar ok=true ao
 * caller (anti-enumeration); a decisão impede APENAS o envio real do email/SMS.
 */
export function shouldRateLimit(input: RateLimitInput): RateLimitDecision {
  if (input.secondsSinceLast !== null && input.secondsSinceLast < MAGIC_LINK_THROTTLE_SECONDS) {
    return {
      allowed: false,
      retryAfterSeconds: MAGIC_LINK_THROTTLE_SECONDS - input.secondsSinceLast,
      reason: 'throttle',
    }
  }
  if (input.requestCount >= MAGIC_LINK_MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: MAGIC_LINK_WINDOW_SECONDS,
      reason: 'max_per_window',
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

// ─── URL builder ─────────────────────────────────────────────────────────

/**
 * Monta URL completa do magic link pra incluir no email/SMS.
 * Tenant subdomain (ADR 0065) já vem em `tenantBaseUrl`.
 */
export function buildMagicLinkUrl(input: {
  tenantBaseUrl: string // ex: 'https://academiax.logifit.com.br'
  token: string
  redirectTo?: string // pós-login, ex: '/meu/agenda'
}): string {
  const params = new URLSearchParams()
  params.set('t', input.token)
  if (input.redirectTo) {
    params.set('to', input.redirectTo)
  }
  // /meu/login/verify é a rota PWA que consome o token
  return `${input.tenantBaseUrl}/meu/login/verify?${params.toString()}`
}
