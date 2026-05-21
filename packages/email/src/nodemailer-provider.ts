/**
 * NodemailerEmailProvider — transport SMTP via nodemailer.
 *
 * Mesma classe pra Brevo prod (`smtp-relay.brevo.com:587`) e Mailhog dev
 * (`localhost:1025`) — diferença é apenas env vars passadas no construtor
 * (ADR 0096 revisado §"Transport: SMTP em vez de API REST").
 *
 * Provider mantém connection pool TCP via nodemailer — instanciar uma vez
 * por process e reusar (não criar transporter em cada call).
 *
 * Mensagens de erro NÃO são expostas ao usuário final — vão pra logs (Loki)
 * + audit_log via wrapAction (ADR 0071).
 */

import nodemailer, { type Transporter } from 'nodemailer'
import { resolveEmailSender } from './resolve-sender'
import type {
  EmailProvider,
  SendTransactionalInput,
  SendTransactionalResult,
} from './types'

export interface NodemailerProviderConfig {
  host: string
  port: number
  /** STARTTLS upgrade (porta 587 default) vs SSL implícito (porta 465). */
  secure?: boolean
  /** Auth opcional — Mailhog dev não exige; Brevo exige user+password SMTP. */
  auth?: {
    user: string
    pass: string
  }
  /** Nome amigável do provider pra logs (`'brevo-smtp'` ou `'smtp'`). */
  providerName: 'brevo-smtp' | 'smtp'
  /** Timeout TCP em ms — defaults 10s pra connection, 20s pra greeting/socket. */
  connectionTimeoutMs?: number
  socketTimeoutMs?: number
}

export class NodemailerEmailProvider implements EmailProvider {
  readonly providerName: 'brevo-smtp' | 'smtp'
  private readonly transport: Transporter

  constructor(config: NodemailerProviderConfig) {
    this.providerName = config.providerName
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? false,
      auth: config.auth,
      connectionTimeout: config.connectionTimeoutMs ?? 10_000,
      socketTimeout: config.socketTimeoutMs ?? 20_000,
      // Pool — reusa connections TCP até 5 paralelas / connection-reuse 100 emails
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    })
  }

  async sendTransactional(
    input: SendTransactionalInput,
  ): Promise<SendTransactionalResult> {
    let sender: ReturnType<typeof resolveEmailSender>
    try {
      sender = resolveEmailSender(input)
    } catch (err) {
      return {
        ok: false,
        provider: this.providerName,
        error: err instanceof Error ? err.message : 'unknown_sender_error',
        errorCode: 'sender_resolution_failed',
      }
    }

    try {
      const info = await this.transport.sendMail({
        from: `"${sender.fromName}" <${sender.fromEmail}>`,
        replyTo: sender.replyTo,
        to: input.toName ? `"${input.toName}" <${input.to}>` : input.to,
        subject: input.subject,
        html: input.htmlBody,
        text: input.textBody,
      })

      return {
        ok: true,
        provider: this.providerName,
        messageId: info.messageId,
        resolvedFrom: sender.fromEmail,
      }
    } catch (err) {
      // Classify common errors via nodemailer error code (.code property)
      // Refs: https://nodemailer.com/usage/#error-handling
      const code = isErrorWithCode(err) ? err.code : undefined
      const errorCode = classifyError(code)
      return {
        ok: false,
        provider: this.providerName,
        error: err instanceof Error ? err.message : 'unknown_send_error',
        errorCode,
      }
    }
  }

  /**
   * Fecha o connection pool. Idempotente. Chamar em shutdown gracioso do
   * process (`SIGTERM`) — opcional, processo morrendo já libera TCP.
   */
  async close(): Promise<void> {
    this.transport.close()
  }
}

// ─── helpers internos ──────────────────────────────────────────────

function isErrorWithCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err
}

/**
 * Mapeia codes nodemailer pra códigos canônicos do envelope LogiFit.
 * Lista baseada em https://nodemailer.com/usage/#error-handling +
 * códigos SMTP genéricos (RFC 5321).
 */
function classifyError(code: string | undefined): string {
  if (!code) return 'send_failed'
  switch (code) {
    case 'EAUTH':
      return 'auth_failed'
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'ETIMEDOUT':
    case 'ECONNREFUSED':
      return 'connection_failed'
    case 'EENVELOPE':
      return 'invalid_recipient'
    case 'EMESSAGE':
      return 'invalid_message'
    case 'EDNS':
      return 'dns_failed'
    default:
      return `send_failed:${code.toLowerCase()}`
  }
}
