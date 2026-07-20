/**
 * /cadastro/mfa-setup — Wizard MFA TOTP (Sprint 02b3 ADR 0094).
 *
 * Server Component valida passport session via requirePassportSession. Sem
 * session → redirect /meu/login. Com session: renderiza MfaSetupWizard
 * client component pra fluxo 3-step.
 */
import { requirePassportSession } from '../../lib/passport-session'
import { MfaSetupWizard } from './wizard'

export const dynamic = 'force-dynamic'

export default async function MfaSetupPage() {
  await requirePassportSession('/cadastro/mfa-setup')

  return (
    <div className="ev-portal-page" style={{ padding: 'var(--ev-space-lg)', maxWidth: 560 }}>
      <header style={{ marginBottom: 'var(--ev-space-lg)' }}>
        <h1 className="ev-portal-h1">Ativar autenticação em 2 fatores</h1>
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Aumente a segurança da sua conta com um código de 6 dígitos do seu app authenticator
          (Google Authenticator, Authy, 1Password, Bitwarden ou similar).
        </p>
      </header>

      <MfaSetupWizard />
    </div>
  )
}
