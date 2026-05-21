/**
 * Tipos canônicos do `@repo/email` — interface `EmailProvider` + envelope.
 *
 * Definidos por:
 * - [ADR 0096](../../../docs/decisions/0096-email-brevo-substitui-aws-ses.md) — provider Brevo via SMTP
 * - [ADR 0097](../../../docs/decisions/0097-email-sender-categoria-branding-por-tier.md) — sender por categoria
 */

/**
 * Categoria do email — define quem aparece como sender (ADR 0097).
 *
 * - `platform` — LogiFit é controlador LGPD (cadastro, magic link, MFA, trial,
 *   alerts internos). Sender SEMPRE `no-reply@logifit.com.br`.
 * - `tenant` — tenant é controlador LGPD (convite, agendamento, fatura, régua
 *   clínica). Sender segue `tenant_email_settings` ou fallback LogiFit com
 *   `Reply-To: tenant`.
 */
export type EmailCategory = 'platform' | 'tenant'

export interface SendTransactionalInput {
  /** Email do destinatário. Multi-recipient não suportado MVP — uma chamada por destinatário (audit + LGPD trail). */
  to: string
  /** Nome do destinatário (opcional — preserva privacy em logs se omitir). */
  toName?: string
  /** Subject — string i18n já resolvida pelo caller via next-intl (regra 27). */
  subject: string
  /** Body HTML — string i18n já resolvida. Caller deve sanitizar input externo antes de injetar. */
  htmlBody: string
  /** Body text (fallback pra clientes sem HTML — boa prática RFC 5322; opcional). */
  textBody?: string
  /** Categoria — define resolver de sender. ADR 0097. */
  category: EmailCategory
  /** Tenant ID — obrigatório quando `category='tenant'` pra resolver sender. */
  tenantId?: string
  /** Override de `Reply-To` quando caller já conhece (ex: invite link manda reply pra profissional emissor). */
  replyTo?: string
}

export interface SendTransactionalSuccess {
  ok: true
  /** Provider que enviou (pra audit/debug). */
  provider: 'brevo-smtp' | 'smtp' | 'mock'
  /** Message ID retornado pelo SMTP server (formato `<random@host>`). */
  messageId: string
  /** Sender real usado (após `resolveEmailSender`) — pra audit. */
  resolvedFrom: string
}

export interface SendTransactionalFailure {
  ok: false
  provider: 'brevo-smtp' | 'smtp' | 'mock'
  /** Mensagem de erro pra logging — NUNCA expor ao usuário final (pode vazar info sensível). */
  error: string
  /** Código de erro estruturado (ex: `'auth_failed'`, `'rate_limited'`, `'invalid_recipient'`). */
  errorCode?: string
}

export type SendTransactionalResult = SendTransactionalSuccess | SendTransactionalFailure

/**
 * Sender resolvido (output de `resolveEmailSender`).
 *
 * `fromEmail` + `fromName` viram o cabeçalho `From: "Name" <email>`.
 * `replyTo` (opcional) vira cabeçalho `Reply-To:` separado.
 */
export interface ResolvedSender {
  fromEmail: string
  fromName: string
  replyTo?: string
}

/**
 * Interface canônica do provider — qualquer impl (BrevoSmtp, Smtp genérico, Mock)
 * implementa o mesmo contrato.
 *
 * Provider é stateful (mantém TCP socket pool no caso SMTP) — instanciar uma vez
 * por process via `resolveEmailProvider()` singleton.
 */
export interface EmailProvider {
  /** Identificador do provider (pra audit/logging). */
  readonly providerName: 'brevo-smtp' | 'smtp' | 'mock'
  /**
   * Envia email transacional. Resolve sender internamente via `resolveEmailSender(input)`
   * antes de despachar. Nunca lança — sempre retorna `SendTransactionalResult`.
   */
  sendTransactional(input: SendTransactionalInput): Promise<SendTransactionalResult>
}
