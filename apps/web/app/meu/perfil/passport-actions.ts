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
 * (Brevo dependency — ADR 0096 substitui AWS SES). Sprint 02b3 completo.
 *
 * **Sprint 02b5+**: 2FA via WebAuthn passkey (alternativa a TOTP), recovery
 * codes regeneration cron, account merge (paciente tem 2 identities por engano).
 */

import { pool } from '@repo/db/client'
import { sendTransactional } from '@repo/email'
import { ApiException } from '@repo/errors'
import {
  encryptSecret,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  verifyPassword,
} from '@repo/security'
import { z } from 'zod'
import { dispatchEmailVerification } from '../../lib/dispatch-email-verification'
import {
  renderEmailChangeConfirmationHtml,
  renderEmailChangeConfirmationText,
  renderEmailChangeNotificationHtml,
  renderEmailChangeNotificationText,
} from '../../lib/email-templates/email-change'
import {
  generateEmailVerificationToken,
  hashEmailVerificationToken,
} from '../../lib/passport-email-verification'
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

const RequestEmailChangeSchema = z.object({
  /** Senha atual — re-verify pra alta sensibilidade (MFA recente sozinho não basta) */
  currentPassword: z.string().min(8).max(128),
  /** Novo email target */
  newEmail: z.string().email().max(255),
})

/** Cooldown entre requests de change_email — 24h pra evitar abuso */
const EMAIL_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Cooldown entre reenvios de email de confirmação (kind='signup') — 5min */
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000

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

// ─── requestPassportEmailChange ────────────────────────────────────────

/**
 * Solicita troca de email da identidade global passport (Sprint 02b5).
 *
 * **Alta sensibilidade — 3 gates:**
 *   1. MFA recente <15min (via wrapPassportAction requireMfa)
 *   2. Re-verify password (caller passa current password — confirma posse)
 *   3. Cooldown 24h entre requests (anti-abuse)
 *
 * Fluxo:
 *   1. Verifica password atual
 *   2. Detecta duplicação (newEmail já em uso por outro identity)
 *   3. Cooldown: nenhum request de change_email <24h pra esta identity
 *   4. Gera token + INSERT kind='change_email' + new_email
 *   5. Envia email de **confirmação pro NOVO email** (paciente clica pra ativar)
 *
 * NÃO atualiza `email` ainda — só após paciente clicar link pelo novo endereço
 * (`confirmPassportEmailChange`). Old email recebe notificação só depois.
 */
export const requestPassportEmailChange = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'email.change.request',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_identities',
    requireMfa: true,
    schema: RequestEmailChangeSchema,
  },
  async (input, { session }) => {
    const newEmailLower = input.newEmail.toLowerCase()

    // 1. Lookup identity (current email + password_hash)
    const r = await pool.query<{
      id: string
      email: string
      name: string
      password_hash: string
    }>(
      `SELECT id, email, name, password_hash
       FROM passport_global_identities
       WHERE id = $1 AND deactivated_at IS NULL
       LIMIT 1`,
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

    // 2. Se newEmail é igual ao atual, no-op
    if (identity.email.toLowerCase() === newEmailLower) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'O novo email é igual ao atual',
        request_id: '',
      })
    }

    // 3. Verifica password atual (re-auth de alta sensibilidade)
    const passwordOk = await verifyPassword(input.currentPassword, identity.password_hash)
    if (!passwordOk) {
      throw new ApiException({
        code: 'UNAUTHORIZED',
        message: 'Senha atual incorreta',
        request_id: '',
      })
    }

    // 4. Detecta newEmail em uso por outro identity ativo
    //    (anti-enumeration: erro genérico — não revela "email existe ou não")
    const dup = await pool.query<{ id: string }>(
      `SELECT id FROM passport_global_identities
       WHERE lower(email) = $1 AND deactivated_at IS NULL AND id != $2
       LIMIT 1`,
      [newEmailLower, identity.id],
    )
    if (dup.rows.length > 0) {
      throw new ApiException({
        code: 'CONFLICT',
        message:
          'Não foi possível usar este email. Se você possui outra conta com este endereço, use ela.',
        request_id: '',
      })
    }

    // 5. Cooldown: nenhuma change_email request <24h pra esta identity
    const recent = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM passport_email_verification_tokens
       WHERE passport_global_identity_id = $1 AND kind = 'change_email'
         AND created_at > now() - interval '24 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [identity.id],
    )
    if (recent.rows.length > 0) {
      const ageMs = Date.now() - recent.rows[0]!.created_at.getTime()
      const retryAfterHours = Math.ceil((EMAIL_CHANGE_COOLDOWN_MS - ageMs) / (60 * 60 * 1000))
      throw new ApiException({
        code: 'RATE_LIMITED',
        message: `Você já solicitou troca de email recentemente. Tente novamente em ${retryAfterHours}h.`,
        request_id: '',
      })
    }

    // 6. Gera token + INSERT kind='change_email'
    const link = generateEmailVerificationToken()
    await pool.query(
      `INSERT INTO passport_email_verification_tokens
         (passport_global_identity_id, email, kind, new_email, token_hash, expires_at, request_ip)
       VALUES ($1, $2, 'change_email', $3, $4, $5, $6)`,
      [
        identity.id,
        identity.email, // snapshot do email atual
        input.newEmail,
        link.tokenHash,
        link.expiresAt,
        null, // request_ip — Sprint 02b6 popula via getClientIp se quiser
      ],
    )

    // 7. Envia confirmação pro NOVO email
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.logifit.com.br'
    const confirmUrl = `${baseUrl}/api/meu/perfil/email/confirm-change?t=${link.token}`

    const result = await sendTransactional({
      to: input.newEmail,
      toName: identity.name,
      subject: 'Confirme seu novo email — LogiFit',
      htmlBody: renderEmailChangeConfirmationHtml({
        patientName: identity.name,
        newEmail: input.newEmail,
        confirmUrl,
      }),
      textBody: renderEmailChangeConfirmationText({
        patientName: identity.name,
        newEmail: input.newEmail,
        confirmUrl,
      }),
      category: 'platform',
    })

    if (!result.ok) {
      // Log audit sem expor pro caller (UX uniforme)
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'email_change_confirmation_send_failed',
          provider: result.provider,
          errorCode: result.errorCode,
          identityIdPrefix: identity.id.slice(0, 8),
        }),
      )
    }

    return {
      ok: true as const,
      note:
        `Enviamos um link de confirmação pro novo email. Clique no link de lá pra ativar a troca. ` +
        `O link expira em 24 horas. Você só pode pedir uma nova troca a cada 24 horas.`,
    }
  },
)

// ─── confirmPassportEmailChange (PRÉ-AUTH) ─────────────────────────────

const ConfirmEmailChangeSchema = z.object({
  token: z.string().min(8).max(256),
})

/**
 * Confirma troca de email — paciente clica link recebido no NOVO email.
 *
 * Pré-auth (sem session — paciente pode estar deslogado ou em outro device).
 *
 * Fluxo:
 *   1. Lookup token kind='change_email' + JOIN identity
 *   2. Valida (4 modes): invalid_format / used / expired / current email mismatch
 *   3. Verifica se new_email ainda está disponível (outro identity pode ter
 *      reservado entre request e confirm)
 *   4. Transação: marca token used + UPDATE identity.email = new_email +
 *      email_verified_at = now() (já confirmamos posse do new)
 *   5. Notifica email ANTIGO (alerta de segurança "email foi alterado pra X")
 */
// wrap-exempt: pré-auth público (paciente clica link sem session)
export async function confirmPassportEmailChange(input: unknown) {
  const parsed = ConfirmEmailChangeSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Token inválido',
      request_id: '',
    })
  }
  const { token } = parsed.data
  const tokenHash = hashEmailVerificationToken(token)

  // 1. Lookup token + identity em 1 query
  const r = await pool.query<{
    token_id: string
    snapshot_email: string
    new_email: string
    expires_at: Date
    used_at: Date | null
    identity_id: string
    current_email: string
    identity_name: string
    deactivated_at: Date | null
  }>(
    `SELECT
       t.id AS token_id,
       t.email AS snapshot_email,
       t.new_email,
       t.expires_at,
       t.used_at,
       i.id AS identity_id,
       i.email AS current_email,
       i.name AS identity_name,
       i.deactivated_at
     FROM passport_email_verification_tokens t
     INNER JOIN passport_global_identities i ON i.id = t.passport_global_identity_id
     WHERE t.token_hash = $1 AND t.kind = 'change_email'
     LIMIT 1`,
    [tokenHash],
  )
  const row = r.rows[0]
  if (!row || !row.new_email) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Link de troca de email inválido',
      request_id: '',
    })
  }
  if (row.deactivated_at) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Conta desativada — não é possível trocar email',
      request_id: '',
    })
  }
  if (row.used_at) {
    throw new ApiException({
      code: 'CONFLICT',
      message: 'Link já utilizado — troca de email já foi feita',
      request_id: '',
    })
  }
  if (Date.now() > row.expires_at.getTime()) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Link expirado — solicite novamente a troca em /meu/perfil',
      request_id: '',
    })
  }
  // Snapshot mismatch: email atual da identity != snapshot do token =
  // já trocou pra outro depois desse request
  if (row.current_email.toLowerCase() !== row.snapshot_email.toLowerCase()) {
    throw new ApiException({
      code: 'CONFLICT',
      message: 'Email da conta foi alterado por outro request — solicite nova troca',
      request_id: '',
    })
  }

  const oldEmail = row.current_email
  const newEmail = row.new_email
  const patientName = row.identity_name

  // 2. Re-check disponibilidade do new_email (outro identity pode ter
  //    pego entre request e confirm — race muito raro mas defesa)
  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM passport_global_identities
     WHERE lower(email) = lower($1) AND deactivated_at IS NULL AND id != $2
     LIMIT 1`,
    [newEmail, row.identity_id],
  )
  if (dup.rows.length > 0) {
    throw new ApiException({
      code: 'CONFLICT',
      message:
        'Não foi possível ativar este email — outro usuário começou a usar entre o pedido e o clique. Solicite nova troca.',
      request_id: '',
    })
  }

  // 3. Transação: marca used + UPDATE email + email_verified_at
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE passport_email_verification_tokens SET used_at = now() WHERE id = $1`,
      [row.token_id],
    )
    await client.query(
      `UPDATE passport_global_identities
       SET email = $1, email_verified_at = now(), updated_at = now()
       WHERE id = $2`,
      [newEmail, row.identity_id],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // 4. Notifica email ANTIGO (alerta de segurança, fire-and-forget)
  void sendTransactional({
    to: oldEmail,
    toName: patientName,
    subject: '⚠ Email da sua conta LogiFit foi alterado',
    htmlBody: renderEmailChangeNotificationHtml({ patientName, newEmail }),
    textBody: renderEmailChangeNotificationText({ patientName, newEmail }),
    category: 'platform',
  }).catch((err) => {
    console.warn(
      '[confirmPassportEmailChange] notificação old email falhou:',
      err instanceof Error ? err.message : err,
    )
  })

  return {
    ok: true as const,
    newEmail,
    passportGlobalId: row.identity_id,
  }
}

// ─── resendPassportEmailVerification ────────────────────────────────────

/**
 * Reenvia email de confirmação do signup (Sprint 02b5).
 *
 * **Sem MFA gate** (intencional) — paciente pode estar com `email_verified_at
 * IS NULL` e querer reenviar antes mesmo de conseguir fazer login completo;
 * exigir MFA aqui criaria UX paradoxal. Proteção: cooldown 5min + cap de
 * tokens ativos via dispatchEmailVerification.
 *
 * Idempotente: se `email_verified_at` já está setado, retorna ok sem gerar
 * novo token (paciente confirmou em outra session/dispositivo). UX informa.
 *
 * Cooldown: nenhum token kind='signup' ativo (used_at IS NULL) <5min
 * pra esta identity. Excedido → RATE_LIMITED com retry-after em segundos.
 */
export const resendPassportEmailVerification = wrapPassportAction(
  {
    module: 'meu.perfil',
    action: 'email.verification.resend',
    returnTo: '/meu/perfil',
    resourceType: 'passport_global_identities',
    requireMfa: false,
  },
  async (_input: void, { session }) => {
    // 1. Lookup identity (email atual + nome + status verificado)
    const r = await pool.query<{
      id: string
      email: string
      name: string
      email_verified_at: Date | null
    }>(
      `SELECT id, email, name, email_verified_at
       FROM passport_global_identities
       WHERE id = $1 AND deactivated_at IS NULL
       LIMIT 1`,
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

    // 2. Idempotência: já verificado → ok sem ação
    if (identity.email_verified_at) {
      return {
        ok: true as const,
        alreadyVerified: true,
        note: 'Seu email já está confirmado. Não foi necessário reenviar.',
      }
    }

    // 3. Cooldown 5min: nenhum token kind='signup' ativo <5min
    const recent = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM passport_email_verification_tokens
       WHERE passport_global_identity_id = $1
         AND kind = 'signup'
         AND created_at > now() - interval '5 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [identity.id],
    )
    if (recent.rows.length > 0) {
      const ageMs = Date.now() - recent.rows[0]!.created_at.getTime()
      const retryAfterSec = Math.ceil((EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - ageMs) / 1000)
      throw new ApiException({
        code: 'RATE_LIMITED',
        message: `Aguarde ${retryAfterSec}s antes de pedir outro reenvio (anti-spam).`,
        request_id: '',
      })
    }

    // 4. Dispara email — failure-tolerant (não vaza erro pro caller)
    const result = await dispatchEmailVerification({
      passportGlobalId: identity.id,
      email: identity.email,
      patientName: identity.name,
    })

    return {
      ok: true as const,
      alreadyVerified: false,
      sent: result.sent,
      provider: result.provider,
      note: result.sent
        ? `Email de confirmação reenviado pra ${identity.email}. Verifique sua caixa de entrada (e spam) — o link expira em 24h.`
        : 'Reenvio falhou — tente novamente em alguns minutos. Se persistir, contate privacidade@logifit.com.br.',
    }
  },
)
