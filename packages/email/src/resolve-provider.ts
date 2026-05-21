/**
 * Resolve provider singleton — decide qual `EmailProvider` usar baseado em env
 * ([ADR 0096](../../../docs/decisions/0096-email-brevo-substitui-aws-ses.md) revisado).
 *
 * Estratégia:
 *   - `NODE_ENV === 'test'` → `MockEmailProvider` (sem rede, recorded emails)
 *   - `SMTP_HOST` + `SMTP_PORT` setados → `NodemailerEmailProvider` apontando pra
 *     SMTP local (Mailhog dev quando `SMTP_HOST=localhost:1025`)
 *   - `BREVO_SMTP_*` completo → `NodemailerEmailProvider` apontando pra Brevo
 *     (`smtp-relay.brevo.com:587`)
 *   - Fallback → `MockEmailProvider` (loga + retorna sucesso) — preserva fluxo
 *     em dev sem Mailhog rodando
 *
 * Em **production** sem nenhum SMTP configurado → throw (fail-loud — emails são
 * canal de auth/audit crítico, mock em prod é violação grave).
 *
 * Singleton process-wide pra reusar TCP pool do nodemailer (regra 36 — não
 * abrir/fechar socket por email).
 */

import { MockEmailProvider } from './mock-provider'
import { NodemailerEmailProvider } from './nodemailer-provider'
import type { EmailProvider } from './types'

let cachedProvider: EmailProvider | null = null

export function resolveEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider
  cachedProvider = createProvider()
  return cachedProvider
}

/**
 * Reseta o singleton — usado em tests pra forçar recriação após mudar env vars.
 * NÃO usar em código de produção.
 */
export function resetEmailProvider(): void {
  cachedProvider = null
}

function createProvider(): EmailProvider {
  const isTest = process.env.NODE_ENV === 'test'
  if (isTest) {
    return new MockEmailProvider()
  }

  const isProd = process.env.NODE_ENV === 'production'

  // Dev SMTP (Mailhog) — host/porta locais
  const devSmtpHost = process.env.SMTP_HOST
  const devSmtpPort = process.env.SMTP_PORT
  if (devSmtpHost && devSmtpPort && !isProd) {
    return new NodemailerEmailProvider({
      host: devSmtpHost,
      port: Number(devSmtpPort),
      secure: false,
      providerName: 'smtp',
    })
  }

  // Brevo SMTP (prod)
  const brevoHost = process.env.BREVO_SMTP_HOST
  const brevoPort = process.env.BREVO_SMTP_PORT
  const brevoUser = process.env.BREVO_SMTP_USER
  const brevoPass = process.env.BREVO_SMTP_PASSWORD
  if (brevoHost && brevoPort && brevoUser && brevoPass) {
    return new NodemailerEmailProvider({
      host: brevoHost,
      port: Number(brevoPort),
      secure: false, // STARTTLS upgrade no port 587
      auth: { user: brevoUser, pass: brevoPass },
      providerName: 'brevo-smtp',
    })
  }

  if (isProd) {
    throw new Error(
      '[email] Nenhum provider SMTP configurado em produção — emails são canal ' +
        'crítico de auth/audit (ADR 0096). Configurar BREVO_SMTP_HOST/PORT/USER/PASSWORD ' +
        'ou SMTP_HOST/PORT (Postal self-host).',
    )
  }

  // Dev sem Mailhog rodando + sem Brevo configurado — mock (loga e segue)
  return new MockEmailProvider()
}
