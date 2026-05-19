'use server'

/**
 * /cadastro/mfa-setup — Server Actions (Sprint 02b3 ADR 0094).
 *
 * Wizard MFA TOTP pós-signup. Paciente já tem passport session ativa
 * (criada por signupPatient) mas ainda não fez setup TOTP. Esta página
 * orquestra:
 *   1. enrollTotp: gera secret + cifra + grava (sem ainda marcar enrolled)
 *   2. confirmTotp: paciente digita código do app authenticator → verifica
 *      → se OK: marca mfa_enrolled_at + markPassportSessionMfaVerified +
 *      gera recovery codes novos
 *   3. cancelTotpEnroll: paciente desiste → limpa secret_encrypted
 *
 * **Sprint 02b4 cleanup**: migrado pra `wrapPassportAction()` helper —
 * requirePassportSession + withPassportContext automáticos. Lint custom
 * reconhece via `RE_WRAP_ACTION` ampliado `wrap(?:Server|Member|Passport)?Action(`.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  generateTotpUri,
  hashRecoveryCode,
  verifyTotp,
} from '@repo/security'
import { z } from 'zod'
import { markPassportSessionMfaVerified } from '../../lib/passport-session'
import { wrapPassportAction } from '../../lib/wrap-passport-action'

const ConfirmTotpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Código deve ter 6 dígitos'),
})

// ─── enrollTotp ────────────────────────────────────────────────────────

/**
 * Inicia enrollment: gera secret novo + cifra + grava sem marcar
 * `mfa_enrolled_at`. Retorna o secret plain (uma vez) + URI otpauth://
 * pro frontend renderizar QR ou exibir texto.
 *
 * Idempotente — chamadas múltiplas geram secret novo (sobrescrevem).
 */
export const enrollTotp = wrapPassportAction(
  {
    module: 'meu.mfa',
    action: 'totp.enroll',
    returnTo: '/cadastro/mfa-setup',
    resourceType: 'passport_global_identities',
  },
  async (_input: void, { session }) => {
    // 1. Busca identity pra resolver email (label da URI otpauth://)
    const r = await pool.query<{ email: string; mfa_enrolled_at: Date | null }>(
      `SELECT email, mfa_enrolled_at FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passportGlobalId],
    )
    const identity = r.rows[0]
    if (!identity) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Identidade global não encontrada',
        request_id: '',
      })
    }
    if (identity.mfa_enrolled_at) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'MFA já está ativo — desative em /meu/perfil antes de re-enrollar',
        request_id: '',
      })
    }

    // 2. Gera secret novo + cifra + grava (sem marcar enrolled)
    const secret = generateTotpSecret()
    const encrypted = encryptSecret(secret)

    await pool.query(
      `UPDATE passport_global_identities
       SET mfa_totp_secret_encrypted = $1, updated_at = now()
       WHERE id = $2`,
      [encrypted, session.passportGlobalId],
    )

    // 3. Gera URI pro QR code
    const uri = generateTotpUri(secret, identity.email, 'LogiFit')

    return {
      ok: true as const,
      secret,
      uri,
      note:
        'Escaneie o QR code com seu app authenticator (Google Authenticator, Authy, 1Password). ' +
        'Em seguida, digite o código de 6 dígitos pra confirmar.',
    }
  },
)

// ─── confirmTotp ───────────────────────────────────────────────────────

/**
 * Verifica código TOTP digitado contra secret armazenado. Se válido:
 *   1. Marca `passport_global_identities.mfa_enrolled_at = now()`
 *   2. Gera 10 recovery codes novos + cifra + grava (substitui anteriores)
 *   3. Marca `passport_global_sessions.mfa_verified_at = now()` (current session)
 *
 * Retorna recovery codes plain pro paciente salvar (única chance).
 */
export const confirmTotp = wrapPassportAction(
  {
    module: 'meu.mfa',
    action: 'totp.confirm',
    returnTo: '/cadastro/mfa-setup',
    resourceType: 'passport_global_identities',
    schema: ConfirmTotpSchema,
  },
  async (input, { session }) => {
    // 1. Busca secret cifrado
    const r = await pool.query<{
      mfa_totp_secret_encrypted: string | null
      mfa_enrolled_at: Date | null
    }>(
      `SELECT mfa_totp_secret_encrypted, mfa_enrolled_at
       FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passportGlobalId],
    )
    const identity = r.rows[0]
    if (!identity) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Identidade global não encontrada',
        request_id: '',
      })
    }
    if (identity.mfa_enrolled_at) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'MFA já estava ativo — recovery codes só geram uma vez',
        request_id: '',
      })
    }
    if (!identity.mfa_totp_secret_encrypted) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Setup MFA não foi iniciado — chame enrollTotp primeiro',
        request_id: '',
      })
    }

    // 2. Decifra secret + verifyTotp
    let secret: string
    try {
      secret = decryptSecret(identity.mfa_totp_secret_encrypted)
    } catch (err) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao decifrar secret TOTP — re-inicie o setup',
        request_id: '',
        details: { reason: err instanceof Error ? err.message : 'unknown' },
      })
    }

    if (!verifyTotp(input.code, secret)) {
      throw new ApiException({
        code: 'UNAUTHORIZED',
        message: 'Código TOTP inválido — confira o app authenticator',
        request_id: '',
      })
    }

    // 3. Gera recovery codes + grava + marca enrolled
    const recoveryCodesPlain = generateRecoveryCodes(10)
    const codesPayload = recoveryCodesPlain.map((c) => ({
      hash: hashRecoveryCode(c),
      used_at: null,
    }))
    const recoveryCodesEncrypted = encryptSecret(JSON.stringify(codesPayload))

    await pool.query(
      `UPDATE passport_global_identities
       SET mfa_enrolled_at = now(),
           recovery_codes_encrypted = $1,
           updated_at = now()
       WHERE id = $2`,
      [recoveryCodesEncrypted, session.passportGlobalId],
    )

    // 4. Promove session atual com mfa_verified_at = now()
    await markPassportSessionMfaVerified(session.sessionId)

    return {
      ok: true as const,
      recoveryCodes: recoveryCodesPlain,
      note:
        'MFA ativado! Guarde os códigos de recuperação — você precisará deles se perder o celular. ' +
        'Cada código só funciona uma vez.',
    }
  },
)

// ─── cancelTotpEnroll ─────────────────────────────────────────────────

/**
 * Paciente desiste do setup MFA. Limpa `mfa_totp_secret_encrypted`
 * (mantém `mfa_enrolled_at` NULL).
 */
export const cancelTotpEnroll = wrapPassportAction(
  {
    module: 'meu.mfa',
    action: 'totp.cancel_enroll',
    returnTo: '/cadastro/mfa-setup',
    resourceType: 'passport_global_identities',
  },
  async (_input: void, { session }) => {
    await pool.query(
      `UPDATE passport_global_identities
       SET mfa_totp_secret_encrypted = NULL, updated_at = now()
       WHERE id = $1 AND mfa_enrolled_at IS NULL`,
      [session.passportGlobalId],
    )

    return { ok: true as const }
  },
)
