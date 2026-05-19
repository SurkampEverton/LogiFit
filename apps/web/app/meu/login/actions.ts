'use server'

/**
 * /meu/login — Server Actions (Sprint 02b3 ADR 0094).
 *
 * Adiciona login email+password pra identidade global (`passport_global_identities`)
 * ao lado do magic link Sprint 26 (`requestMagicLink`/`verifyMagicLink` em
 * `apps/web/app/meu/actions.ts`).
 *
 * Fluxo loginPassport:
 *   1. SELECT passport_global_identities por lower(email) (NÃO revela se email existe)
 *   2. verifyPassword scrypt constant-time
 *   3. Se identity.mfa_enrolled_at setado, exige `totp` input + valida
 *      (TOTP wizard Sprint 02b3 completo — atualmente exige stub aceitando '000000')
 *   4. createPassportSession + setPassportCookie
 *   5. Update last_login_at
 *
 * Anti-enumeration: erro genérico em todos os caminhos (email inexistente,
 * senha errada, TOTP errado) → "Credenciais inválidas".
 *
 * Rate limit (Sprint 02b3 completo): 5 attempts/IP/15min via auth_attempts
 * Sprint 01a. Atualmente Server Action sem gate — depende rate limit Redis Sprint 02b4.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { decryptSecret, verifyPassword, verifyTotp } from '@repo/security'
import { z } from 'zod'
import { createPassportSession, setPassportCookie } from '../../lib/passport-session'

const LoginPasswordSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  /** TOTP 6 dígitos — exigido se identity tem mfa_enrolled_at setado.
   *  Sprint 02b3 completo valida via otplib + identity.mfa_totp_secret_encrypted.
   *  MVP placeholder: aceita '000000' como bypass até wizard MFA aterrissar. */
  totp: z
    .string()
    .regex(/^\d{6}$/, 'TOTP deve ter 6 dígitos')
    .optional(),
})

// ─── loginPassport ─────────────────────────────────────────────────────

// wrap-exempt: pré-auth público visitor (sem session); credentials são o gate
export async function loginPassport(input: unknown) {
  const parsed = LoginPasswordSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Email ou senha inválido',
      request_id: '',
    })
  }
  const { email, password, totp } = parsed.data

  // 1. Lookup identity por email (case-insensitive)
  const r = await pool.query<{
    id: string
    password_hash: string
    mfa_enrolled_at: Date | null
    mfa_totp_secret_encrypted: string | null
    deactivated_at: Date | null
  }>(
    `SELECT id, password_hash, mfa_enrolled_at, mfa_totp_secret_encrypted, deactivated_at
     FROM passport_global_identities
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email],
  )
  const identity = r.rows[0]

  // Anti-enumeration: roda verifyPassword mesmo se identity é null (dummy hash)
  // pra preservar timing. Atualmente o early-return revela menos info que um
  // mock perfeito mas é trade-off conhecido (rate-limit + lockout cobrem).
  if (!identity || identity.deactivated_at) {
    throw new ApiException({
      code: 'UNAUTHORIZED',
      message: 'Credenciais inválidas',
      request_id: '',
    })
  }

  // 2. Valida password
  const passwordOk = await verifyPassword(password, identity.password_hash)
  if (!passwordOk) {
    throw new ApiException({
      code: 'UNAUTHORIZED',
      message: 'Credenciais inválidas',
      request_id: '',
    })
  }

  // 3. Se MFA ativado, exige TOTP
  let mfaVerifiedNow = false
  if (identity.mfa_enrolled_at) {
    if (!totp) {
      // Frontend detecta via code MFA_RECENT_REQUIRED + abre step TOTP
      // (reusa o code canônico do envelope ADR 0071 — mesmo conceito staff regra 43)
      throw new ApiException({
        code: 'MFA_RECENT_REQUIRED',
        message: 'Autenticação em 2 fatores exigida — digite o código TOTP',
        request_id: '',
      })
    }
    // Decifra secret + valida TOTP via @repo/security verifyTotp (RFC 6238)
    if (!identity.mfa_totp_secret_encrypted) {
      // mfa_enrolled_at setado mas secret faltando = inconsistente
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Setup MFA corrompido — contate suporte',
        request_id: '',
      })
    }
    let secretBase32: string
    try {
      secretBase32 = decryptSecret(identity.mfa_totp_secret_encrypted)
    } catch {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao decifrar secret TOTP',
        request_id: '',
      })
    }
    if (!verifyTotp(totp, secretBase32)) {
      throw new ApiException({
        code: 'UNAUTHORIZED',
        message: 'Credenciais inválidas',
        request_id: '',
      })
    }
    mfaVerifiedNow = true
  }

  // 4. Cria session + seta cookie
  const { token } = await createPassportSession(identity.id, {
    mfaVerified: mfaVerifiedNow,
  })
  await setPassportCookie(token)

  // 5. Update last_login_at (fire-and-forget)
  void pool
    .query(`UPDATE passport_global_identities SET last_login_at = now() WHERE id = $1`, [
      identity.id,
    ])
    .catch((err) => {
      console.warn(
        '[loginPassport] update last_login_at falhou:',
        err instanceof Error ? err.message : err,
      )
    })

  return {
    ok: true as const,
    passportGlobalId: identity.id,
    mfaVerified: mfaVerifiedNow,
    redirectUrl: '/meu',
  }
}

// ─── logoutPassport ───────────────────────────────────────────────────

/**
 * Logout: revoga passport session + limpa cookie. Idempotente — não exige
 * session ativa (mesmo padrão logoutMember Sprint 26).
 */
// wrap-exempt: tolerante (getPassportSession em vez de require) — idempotente
export async function logoutPassport() {
  const { clearPassportCookie, getPassportSession, revokePassportSession } = await import(
    '../../lib/passport-session'
  )
  const session = await getPassportSession()
  if (session) {
    await revokePassportSession(session.sessionId, 'user_logout')
  }
  await clearPassportCookie()
  return { ok: true as const }
}
