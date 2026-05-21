/**
 * Passport email verification — geração/verificação de token (Sprint 02b4 fechamento).
 *
 * Mesmo padrão de `packages/db/src/portal-member/magic-link.ts` (Sprint 26)
 * mas com TTL 24h (link de email é menos sensível que login — paciente pode
 * abrir o email muitas horas depois).
 *
 * - Token plano random 32 bytes (256 bits) → base64url
 * - Hash SHA-256 do plano → grava no banco (nunca grava plain)
 * - Single-use via `used_at`
 * - Snapshot do email no token → protege contra change_email race
 *
 * **NÃO usar pra magic link de login** — usar `generateMagicLink` do
 * `@repo/db/portal-member/magic-link` (TTL 15min, padrão diferente).
 */
import crypto from 'node:crypto'

/** TTL email verification: 24 horas. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000

export interface GeneratedEmailVerificationToken {
  /** Token plano — vai no link do email (URL-safe base64url). */
  token: string
  /** SHA-256 hex do token plano — vai no banco. */
  tokenHash: string
  /** Date de expiração. */
  expiresAt: Date
}

export function generateEmailVerificationToken(
  now: Date = new Date(),
): GeneratedEmailVerificationToken {
  const tokenBytes = crypto.randomBytes(32)
  const token = tokenBytes.toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS)
  return { token, tokenHash, expiresAt }
}

/**
 * Re-hash do token plano pra lookup no banco. Mesmo algoritmo do generate.
 */
export function hashEmailVerificationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export type EmailVerificationVerifyResult =
  | { ok: true; tokenHash: string }
  | { ok: false; reason: 'expired' | 'used' | 'invalid_format' | 'email_mismatch' }

export interface PersistedEmailVerificationRow {
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  email: string // snapshot do email no momento da geração
}

/**
 * Verifica token plano contra row persistida.
 *
 * - `invalid_format` — token vazio/curto ou hash não bate
 * - `used` — usedAt != null
 * - `expired` — now > expiresAt
 * - `email_mismatch` — email atual do identity != snapshot do token
 *   (paciente trocou email entre request e clique; protege contra
 *    confirmar email antigo após change_email)
 */
export function verifyEmailVerificationAgainstRow(
  tokenPlain: string,
  row: PersistedEmailVerificationRow,
  currentEmail: string,
  now: Date = new Date(),
): EmailVerificationVerifyResult {
  if (!tokenPlain || tokenPlain.length < 8) {
    return { ok: false, reason: 'invalid_format' }
  }
  const computedHash = hashEmailVerificationToken(tokenPlain)
  if (computedHash !== row.tokenHash) {
    return { ok: false, reason: 'invalid_format' }
  }
  if (row.usedAt) {
    return { ok: false, reason: 'used' }
  }
  if (now.getTime() > row.expiresAt.getTime()) {
    return { ok: false, reason: 'expired' }
  }
  if (row.email.toLowerCase() !== currentEmail.toLowerCase()) {
    return { ok: false, reason: 'email_mismatch' }
  }
  return { ok: true, tokenHash: computedHash }
}
