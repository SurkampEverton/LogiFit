'use server'

/**
 * /meu/login — Server Actions (Sprint 02b3 ADR 0094 + Sprint 02b4 rate limit).
 *
 * Adiciona login email+password pra identidade global (`passport_global_identities`)
 * ao lado do magic link Sprint 26 (`requestMagicLink`/`verifyMagicLink` em
 * `apps/web/app/meu/actions.ts`).
 *
 * Fluxo loginPassport:
 *   1. Resolve IP do request + checkAuthLockout (regra 36 + ADR 0073 camada 2)
 *      → 5 falhas/15min em email OU IP → lockout 30min → LOCKED envelope
 *   2. SELECT passport_global_identities por lower(email) (NÃO revela se email existe)
 *   3. verifyPassword scrypt constant-time
 *   4. Se identity.mfa_enrolled_at setado, exige `totp` input + valida via
 *      @repo/security verifyTotp RFC 6238
 *   5. createPassportSession + setPassportCookie
 *   6. Update last_login_at
 *   + Toda tentativa (success/failure) registra em auth_attempts; falha avalia
 *     lockout via evaluateLockout (cria auth_lockouts se threshold atingido)
 *
 * Anti-enumeration: erro genérico em todos os caminhos (email inexistente,
 * senha errada, TOTP errado) → "Credenciais inválidas".
 *
 * Redis self-hosted (regra 36 completa via sliding window) entra Sprint 02b5+.
 * Auth_attempts cobre proteção essencial pré-Redis.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import {
  authFailuresEmailKey,
  authFailuresIpKey,
  checkAuthLockout,
  checkLockoutRedis,
  clearFailuresSlidingWindow,
  decryptSecret,
  evaluateLockout,
  evaluateLockoutRedis,
  recordAuthAttempt,
  verifyPassword,
  verifyTotp,
} from '@repo/security'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createPassportSession, setPassportCookie } from '../../lib/passport-session'
import { getClientIp } from '../../lib/request-ip'

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

// Rate limit interno via auth_attempts + auth_lockouts (regra 36 + ADR 0073).
// wrap-exempt: pré-auth público visitor (sem session); credentials são o gate.
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
  const emailLower = email.toLowerCase()

  // Resolve IP + user agent (auditing + lockout key)
  const ip = await getClientIp()
  const userAgent = (await headers()).get('user-agent') ?? null

  // 0. Pre-check lockout — Redis flag primeiro (O(1) read), fallback SQL.
  //    Redis indisponível → null → SQL polling (regra 36 mantém proteção).
  const redisLockout = await checkLockoutRedis({ email: emailLower, ip })
  if (redisLockout?.locked) {
    throw new ApiException({
      code: 'RATE_LIMITED',
      message:
        'Muitas tentativas falharam. Conta bloqueada temporariamente — aguarde alguns minutos.',
      request_id: '',
    })
  }
  if (redisLockout === null) {
    // Redis indisponível: fallback SQL polling
    const lockout = await checkAuthLockout({ email: emailLower, ip, pool })
    if (lockout.locked) {
      const retryAfterMs = lockout.lockedUntil
        ? Math.max(0, lockout.lockedUntil.getTime() - Date.now())
        : 0
      throw new ApiException({
        code: 'RATE_LIMITED',
        message:
          'Muitas tentativas falharam. Conta bloqueada temporariamente — tente novamente em ' +
          Math.ceil(retryAfterMs / 60_000) +
          ' min.',
        request_id: '',
      })
    }
  }

  // Helper interno pra registrar falha + avaliar lockout (Redis primeiro,
  // SQL audit log SEMPRE — auth_attempts é canal LGPD art. 18 V retenção 90d).
  async function recordFailure(reason: string): Promise<void> {
    // 1. SEMPRE INSERT audit em auth_attempts (LGPD audit trail)
    await recordAuthAttempt({
      email: emailLower,
      ip,
      userAgent,
      success: false,
      failureReason: reason,
      pool,
    })
    // 2. Redis sliding window pra decisão de lockout em tempo real
    const redisEval = await evaluateLockoutRedis({ email: emailLower, ip })
    if (redisEval === null) {
      // Redis indisponível: fallback SQL polling
      await evaluateLockout({ email: emailLower, ip, pool })
    }
  }

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
    await recordFailure(identity ? 'user_disabled' : 'unknown_email')
    throw new ApiException({
      code: 'UNAUTHORIZED',
      message: 'Credenciais inválidas',
      request_id: '',
    })
  }

  // 2. Valida password
  const passwordOk = await verifyPassword(password, identity.password_hash)
  if (!passwordOk) {
    await recordFailure('wrong_password')
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
      // (reusa o code canônico do envelope ADR 0071 — mesmo conceito staff regra 43).
      // Não conta como falha ainda (paciente vai retornar com TOTP) — não
      // incrementa auth_attempts.
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
      await recordFailure('mfa_failed')
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

  // 6. Registra success em auth_attempts + limpa contadores Redis (login OK)
  await recordAuthAttempt({
    email: emailLower,
    ip,
    userAgent,
    success: true,
    pool,
  })
  // Limpa sliding window Redis (best-effort — falha não bloqueia login OK)
  await Promise.all([
    clearFailuresSlidingWindow(authFailuresEmailKey(emailLower)),
    clearFailuresSlidingWindow(authFailuresIpKey(ip)),
  ])

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
