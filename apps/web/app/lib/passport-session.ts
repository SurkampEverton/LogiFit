/**
 * Passport global session helpers — Sprint 02b3 (ADR 0094).
 *
 * Paciente com identidade global (`passport_global_identities`) usa cookie
 * próprio `lf_passport_session`. Verify lookup hash em
 * `passport_global_sessions`. Cookie httpOnly + Secure + SameSite=Lax + Path=/meu.
 *
 * **Separação clara** do member portal antigo (ADR 0088):
 *   - Cookie distinto (lf_passport_session vs lf_member_session)
 *   - Tabela distinta (passport_global_sessions vs member_sessions)
 *   - Resolução via `getActiveSession()` (passport first + member fallback)
 *
 * **MFA gate**: `requirePassportMfa(claims, maxAgeMinutes)` checa
 * `mfa_verified_at` recency pra ações de alto risco do paciente
 * (trocar email/senha/recovery codes/desativar conta).
 *
 * Sprint 02b4: refresh token rotation single-use (atualmente long-lived 30d).
 */
import { pool } from '@repo/db/client'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const PASSPORT_COOKIE_NAME = 'lf_passport_session'
export const PASSPORT_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60 // 30d
/** Reauth MFA exigido <N min pra ações de alto risco (espelha staff regra 43) */
export const PASSPORT_MFA_MAX_AGE_MS = 15 * 60 * 1000 // 15 min

export interface PassportSessionClaims {
  passportGlobalId: string
  sessionId: string
  /** Setado quando paciente completou TOTP em login fresh */
  mfaVerifiedAt: Date | null
}

/**
 * Gera refresh token plain + hash SHA-256. Caller seta cookie com plain;
 * tabela armazena hash.
 *
 * Padrão idêntico a `generateRefreshToken` em `@repo/db/portal-member`
 * (Sprint 26 ADR 0088) — token 32 bytes random base64url + SHA-256.
 */
export function generatePassportRefreshToken(): {
  token: string
  tokenHash: string
  expiresAt: Date
} {
  const raw = randomBytes(32)
  const token = raw.toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + PASSPORT_COOKIE_MAX_AGE_S * 1000)
  return { token, tokenHash, expiresAt }
}

/**
 * Lê passport session do cookie. Retorna null se ausente/inválido/expirado/revogado.
 */
export async function getPassportSession(): Promise<PassportSessionClaims | null> {
  const c = await cookies()
  const raw = c.get(PASSPORT_COOKIE_NAME)?.value
  if (!raw) return null
  const hash = createHash('sha256').update(raw).digest('hex')

  const r = await pool.query<{
    id: string
    passport_global_identity_id: string
    expires_at: Date
    revoked_at: Date | null
    mfa_verified_at: Date | null
  }>(
    `SELECT id, passport_global_identity_id, expires_at, revoked_at, mfa_verified_at
     FROM passport_global_sessions
     WHERE refresh_token_hash = $1
     LIMIT 1`,
    [hash],
  )
  const row = r.rows[0]
  if (!row) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at.getTime() < Date.now()) return null

  // Update last_seen_at fire-and-forget
  void pool
    .query(`UPDATE passport_global_sessions SET last_seen_at = now() WHERE id = $1`, [row.id])
    .catch(() => {})

  return {
    passportGlobalId: row.passport_global_identity_id,
    sessionId: row.id,
    mfaVerifiedAt: row.mfa_verified_at,
  }
}

/**
 * Lê passport session ou redireciona pra /meu/login.
 */
export async function requirePassportSession(returnTo: string): Promise<PassportSessionClaims> {
  const session = await getPassportSession()
  if (!session) {
    const url = new URL('/meu/login', 'http://placeholder')
    url.searchParams.set('returnTo', returnTo)
    redirect(`${url.pathname}${url.search}`)
  }
  return session
}

/**
 * Exige MFA recente. Lança UNAUTHORIZED se `mfaVerifiedAt` null ou >maxAge.
 * Para ações de alto risco do paciente (trocar senha/email/recovery codes/desativar conta).
 *
 * Análogo a `requireRecentMfa()` staff (regra 43 + ADR 0073) mas pra paciente.
 */
export function requirePassportMfa(
  claims: PassportSessionClaims,
  maxAgeMs: number = PASSPORT_MFA_MAX_AGE_MS,
): void {
  if (!claims.mfaVerifiedAt) {
    throw new Error('MFA_RECENT_REQUIRED: paciente sem TOTP verificado na session')
  }
  const ageMs = Date.now() - claims.mfaVerifiedAt.getTime()
  if (ageMs > maxAgeMs) {
    throw new Error(
      `MFA_RECENT_REQUIRED: TOTP verificado há ${Math.round(ageMs / 60000)}min (máx ${Math.round(maxAgeMs / 60000)}min)`,
    )
  }
}

/**
 * Cria nova session pra paciente passport. Caller (signupPatient ou
 * loginPassport) chama após validar identity + password (+ opcional TOTP).
 *
 * Retorna o refresh token PLAIN pra setar no cookie via `setPassportCookie`.
 *
 * @example
 *   const { token } = await createPassportSession(passportGlobalId, { mfaVerified: true })
 *   await setPassportCookie(token)
 */
export async function createPassportSession(
  passportGlobalId: string,
  opts: { mfaVerified?: boolean; deviceLabel?: string; ip?: string } = {},
): Promise<{ token: string; sessionId: string }> {
  const { token, tokenHash, expiresAt } = generatePassportRefreshToken()
  const r = await pool.query<{ id: string }>(
    `INSERT INTO passport_global_sessions
     (passport_global_identity_id, refresh_token_hash, expires_at,
      device_label, ip, mfa_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      passportGlobalId,
      tokenHash,
      expiresAt,
      opts.deviceLabel ?? null,
      opts.ip ?? null,
      opts.mfaVerified ? new Date() : null,
    ],
  )
  return { token, sessionId: r.rows[0]!.id }
}

/**
 * Revoga session atual (logout). Idempotente — funciona mesmo sem session ativa.
 */
export async function revokePassportSession(
  sessionId: string,
  reason: 'user_logout' | 'admin_revoke' | 'password_change' | 'mfa_change' | 'session_rotation',
): Promise<void> {
  await pool.query(
    `UPDATE passport_global_sessions
     SET revoked_at = now(), revoked_reason = $1
     WHERE id = $2 AND revoked_at IS NULL`,
    [reason, sessionId],
  )
}

/**
 * Seta cookie de session pro browser do paciente.
 */
export async function setPassportCookie(refreshTokenPlain: string): Promise<void> {
  const c = await cookies()
  c.set(PASSPORT_COOKIE_NAME, refreshTokenPlain, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/meu',
    maxAge: PASSPORT_COOKIE_MAX_AGE_S,
  })
}

/**
 * Remove cookie (logout).
 */
export async function clearPassportCookie(): Promise<void> {
  const c = await cookies()
  c.delete(PASSPORT_COOKIE_NAME)
}

/**
 * Executa `fn` com `app.passport_global_id` setado na connection.
 * Ativa RLS self-only em `passport_global_identities` (policy 0057).
 *
 * Análogo a `withMemberContext` (Sprint 26) + `withSessionContext` (Sprint 01a).
 */
export async function withPassportContext<T>(
  claims: PassportSessionClaims,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("SELECT set_config('app.passport_global_id', $1, false)", [
      claims.passportGlobalId,
    ])
    return await fn()
  } finally {
    try {
      await client.query("SELECT set_config('app.passport_global_id', '', false)")
    } catch {
      /* swallow */
    }
    client.release()
  }
}

/**
 * Promove o `mfa_verified_at` da session após TOTP completar (login flow).
 * Caller (`loginPassport` Sprint 02b3 completo) chama após validar TOTP.
 */
export async function markPassportSessionMfaVerified(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE passport_global_sessions SET mfa_verified_at = now() WHERE id = $1`,
    [sessionId],
  )
}
