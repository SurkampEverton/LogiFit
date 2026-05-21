/**
 * dispatchEmailVerification — helper compartilhado pra emitir email de
 * confirmação de signup (kind='signup').
 *
 * Side effects: INSERT em `passport_email_verification_tokens` + chamada
 * SMTP via `@repo/email`. Separado dos helpers puros de `passport-email-
 * verification.ts` pra preservar testabilidade.
 *
 * Callers:
 *   - `signupPatient` em `apps/web/app/cadastro/actions.ts` (passo 9
 *     automático pós-INSERT identity)
 *   - `resendPassportEmailVerification` em `apps/web/app/meu/perfil/
 *     passport-actions.ts` (Sprint 02b5 — UI reenvio)
 *
 * Categoria `platform` (ADR 0097) — LogiFit é controlador LGPD da
 * identidade global do paciente.
 */
import { pool } from '@repo/db/client'
import { sendTransactional } from '@repo/email'
import {
  renderEmailVerificationHtml,
  renderEmailVerificationText,
} from './email-templates/email-verification'
import { generateEmailVerificationToken } from './passport-email-verification'

export interface DispatchEmailVerificationInput {
  passportGlobalId: string
  email: string
  patientName: string
  requestIp?: string | null
}

export interface DispatchEmailVerificationResult {
  /** True se SMTP confirmou envio (mailhog dev ou Brevo prod). */
  sent: boolean
  /** Provider que respondeu (mock/smtp/brevo-smtp). */
  provider: 'mock' | 'smtp' | 'brevo-smtp' | 'unknown'
}

export async function dispatchEmailVerification(
  params: DispatchEmailVerificationInput,
): Promise<DispatchEmailVerificationResult> {
  // 1. Gera token + hash
  const link = generateEmailVerificationToken()

  // 2. Grava token kind='signup' (default no DB) — snapshot do email pra
  //    anti-race contra change_email
  await pool.query(
    `INSERT INTO passport_email_verification_tokens
       (passport_global_identity_id, email, token_hash, expires_at, request_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.passportGlobalId,
      params.email,
      link.tokenHash,
      link.expiresAt,
      params.requestIp ?? null,
    ],
  )

  // 3. Envia email via @repo/email
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.logifit.com.br'
  const verifyUrl = `${baseUrl}/api/cadastro/verify-email?t=${link.token}`

  const result = await sendTransactional({
    to: params.email,
    toName: params.patientName,
    subject: 'Confirme seu email — LogiFit',
    htmlBody: renderEmailVerificationHtml({
      patientName: params.patientName,
      verifyUrl,
    }),
    textBody: renderEmailVerificationText({
      patientName: params.patientName,
      verifyUrl,
    }),
    category: 'platform',
  })

  if (!result.ok) {
    // Audit log estruturado pra Loki — NÃO vaza email do paciente
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'email_verification_send_failed',
        provider: result.provider,
        errorCode: result.errorCode,
        passportGlobalIdPrefix: params.passportGlobalId.slice(0, 8),
      }),
    )
    return { sent: false, provider: result.provider }
  }

  return { sent: true, provider: result.provider }
}
