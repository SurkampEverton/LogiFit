'use server'

/**
 * /meu/perfil — Server Actions da identidade global passport (Sprint 02b4 partial).
 *
 * Demonstra `wrapPassportAction({ requireMfa: true })` — todas 4 mutativas
 * exigem MFA recente <15min (paciente passa por TOTP no login fresh OR
 * já fez TOTP <15min). Sem MFA recente → MFA_RECENT_REQUIRED envelope code.
 *
 * Actions (5):
 *   - changePassword({oldPassword, newPassword}) — MFA exigido
 *   - regenerateRecoveryCodes() — MFA exigido (substitui codes antigos)
 *   - revokeMyPassportSession({sessionId}) — MFA exigido (revoga outra device)
 *   - deactivateAccount({reason, confirmEmail}) — MFA exigido (LGPD art. 18 VI exclusão)
 *   - listMyPassportSessions() — sem MFA (read-only audit)
 *
 * **changeEmail** adiada — exige envio de email confirmação pra new address
 * (AWS SES dependency). Sprint 02b3 completo.
 *
 * **Sprint 02b5+**: 2FA via WebAuthn passkey (alternativa a TOTP), recovery
 * codes regeneration cron, account merge (paciente tem 2 identities por engano).
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  verifyPassword,
} from '@repo/security'
import { z } from 'zod'
import { wrapPassportAction } from '../../lib/wrap-passport-action'

const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().min(8).max(128),
    newPassword: z.string().min(8).max(128),
  })
  .refine((d) => d.oldPassword !== d.newPassword, {
    message: 'Nova senha deve ser diferente da atual',
    path: ['newPassword'],
  })

const RevokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
})

const DeactivateAccountSchema = z.object({
  reason: z.enum(['user_request', 'lgpd_erasure']),
  /** Paciente confirma digitando o email — anti-clique-acidental */
  confirmEmail: z.string().email().max(255),
})

// ─── changePassword ────────────────────────────────────────────────────

export const changePassword = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'password.change',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_identities',
    schema: ChangePasswordSchema,
    requireMfa: true,
  },
  async (input, { session }) => {
    // 1. Busca password_hash atual
    const r = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passportGlobalId],
    )
    const identity = r.rows[0]
    if (!identity) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Identidade não encontrada',
        request_id: '',
      })
    }

    // 2. Valida senha atual
    const ok = await verifyPassword(input.oldPassword, identity.password_hash)
    if (!ok) {
      throw new ApiException({
        code: 'UNAUTHORIZED',
        message: 'Senha atual inválida',
        request_id: '',
      })
    }

    // 3. Hash da nova senha + grava + atualiza password_changed_at
    const newHash = await hashPassword(input.newPassword)
    await pool.query(
      `UPDATE passport_global_identities
       SET password_hash = $1, password_changed_at = now(), updated_at = now()
       WHERE id = $2`,
      [newHash, session.passportGlobalId],
    )

    // 4. Revoga TODAS as outras sessions (force re-login em outros dispositivos)
    //    Mantém current session ativa (paciente continua logado pós-troca senha).
    //    Reason 'password_change' pra audit trail.
    await pool.query(
      `UPDATE passport_global_sessions
       SET revoked_at = now(), revoked_reason = 'password_change'
       WHERE passport_global_identity_id = $1
         AND id != $2
         AND revoked_at IS NULL`,
      [session.passportGlobalId, session.sessionId],
    )

    return { ok: true as const, note: 'Senha alterada. Outras sessions foram encerradas.' }
  },
)

// ─── regenerateRecoveryCodes ────────────────────────────────────────────

export const regenerateRecoveryCodes = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'mfa.regenerate_recovery_codes',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_identities',
    requireMfa: true,
  },
  async (_input: void, { session }) => {
    // Valida MFA já está enrolled (sem MFA, não há codes pra regenerar)
    const r = await pool.query<{ mfa_enrolled_at: Date | null }>(
      `SELECT mfa_enrolled_at FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passportGlobalId],
    )
    if (!r.rows[0]?.mfa_enrolled_at) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'MFA não está ativo — não há códigos de recuperação pra regenerar',
        request_id: '',
      })
    }

    // Gera 10 codes novos + cifra + sobrescreve (codes antigos viram inválidos)
    const recoveryCodesPlain = generateRecoveryCodes(10)
    const codesPayload = recoveryCodesPlain.map((c) => ({
      hash: hashRecoveryCode(c),
      used_at: null,
    }))
    const encrypted = encryptSecret(JSON.stringify(codesPayload))

    await pool.query(
      `UPDATE passport_global_identities
       SET recovery_codes_encrypted = $1, updated_at = now()
       WHERE id = $2`,
      [encrypted, session.passportGlobalId],
    )

    return {
      ok: true as const,
      recoveryCodes: recoveryCodesPlain,
      note: 'Códigos antigos foram invalidados. Salve os novos — única chance.',
    }
  },
)

// ─── listMyPassportSessions ────────────────────────────────────────────

export const listMyPassportSessions = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'sessions.list',
    returnTo: '/meu/perfil',
    // SEM requireMfa — read-only audit
  },
  async (_input: void, { session }) => {
    const r = await pool.query<{
      id: string
      device_label: string | null
      ip: string | null
      created_at: Date
      last_seen_at: Date
      mfa_verified_at: Date | null
      revoked_at: Date | null
      revoked_reason: string | null
    }>(
      `SELECT id, device_label, ip, created_at, last_seen_at, mfa_verified_at,
              revoked_at, revoked_reason
       FROM passport_global_sessions
       WHERE passport_global_identity_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [session.passportGlobalId],
    )
    return {
      ok: true as const,
      sessions: r.rows.map((row) => ({
        ...row,
        isCurrent: row.id === session.sessionId,
      })),
    }
  },
)

// ─── revokeMyPassportSession ───────────────────────────────────────────

export const revokeMyPassportSession = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'sessions.revoke',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_sessions',
    schema: RevokeSessionSchema,
    requireMfa: true,
  },
  async (input, { session }) => {
    // Paciente não pode revogar a current session via esta SA (logout faz isso)
    if (input.sessionId === session.sessionId) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Use logout pra encerrar a session atual',
        request_id: '',
      })
    }

    const r = await pool.query(
      `UPDATE passport_global_sessions
       SET revoked_at = now(), revoked_reason = 'admin_revoke'
       WHERE id = $1
         AND passport_global_identity_id = $2
         AND revoked_at IS NULL`,
      [input.sessionId, session.passportGlobalId],
    )
    if (r.rowCount === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Session não encontrada ou já revogada',
        request_id: '',
      })
    }
    return { ok: true as const }
  },
)

// ─── deactivateAccount ─────────────────────────────────────────────────

export const deactivateAccount = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'account.deactivate',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_identities',
    schema: DeactivateAccountSchema,
    requireMfa: true,
    // Janela MFA mais estrita pra ação destrutiva — 5 min
    mfaMaxAgeMs: 5 * 60 * 1000,
  },
  async (input, { session }) => {
    // 1. Valida email confirmação bate (anti-clique-acidental)
    const r = await pool.query<{ email: string; deactivated_at: Date | null }>(
      `SELECT email, deactivated_at FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passportGlobalId],
    )
    const identity = r.rows[0]
    if (!identity) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Identidade não encontrada',
        request_id: '',
      })
    }
    if (identity.deactivated_at) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Conta já está desativada',
        request_id: '',
      })
    }
    if (identity.email.toLowerCase() !== input.confirmEmail.toLowerCase()) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Email de confirmação não bate com o cadastrado',
        request_id: '',
      })
    }

    // 2. Marca deactivated_at + reason
    //    Sprint 02b5 cron `hard-delete-deactivated-passport` faz hard delete
    //    30 dias após deactivated_at (paciente pode reativar via suporte
    //    nesse período pela LGPD art. 18 — "direito à revogação do consentimento").
    await pool.query(
      `UPDATE passport_global_identities
       SET deactivated_at = now(), deactivated_reason = $1, updated_at = now()
       WHERE id = $2`,
      [input.reason, session.passportGlobalId],
    )

    // 3. Revoga TODAS as sessions ativas (paciente desloga em todos devices)
    await pool.query(
      `UPDATE passport_global_sessions
       SET revoked_at = now(), revoked_reason = 'admin_revoke'
       WHERE passport_global_identity_id = $1
         AND revoked_at IS NULL`,
      [session.passportGlobalId],
    )

    // 4. Pacientes_company_links permanecem (audit trail) — staff de cada
    //    tenant linkado vê membro "desativado globalmente" mas histórico
    //    fica preservado pelos 20 anos Lei 13.787 quando aplicável.
    //    Sprint 02b5 dispara notificação async pros tenants linkados.

    return {
      ok: true as const,
      note:
        'Conta desativada. Você tem 30 dias pra reativar via suporte (privacidade@logifit.com.br) ' +
        'antes do hard delete LGPD art. 18 VI.',
    }
  },
)
