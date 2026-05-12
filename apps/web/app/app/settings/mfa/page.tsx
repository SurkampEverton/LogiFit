import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@repo/auth/server'

/**
 * /app/settings/mfa — gerenciamento de MFA do user atual.
 *
 * Roles `requires_mfa=true` precisam completar enrollment antes de operar
 * outras telas. Middleware atual (Faixa B) só checa cookie presente;
 * gate de MFA exigido vem do Server Component que lê `session.logifit.requiresMfa`.
 *
 * Sprint 01a Faixa C: skeleton. Faixa D+ pluga:
 *   - QR code TOTP (via BetterAuth twoFactor.generateQR)
 *   - Form 6-digit code → twoFactor.verifyTotpSetup
 *   - Recovery codes mostrados 1x + download .txt
 *   - WebAuthn passkey enrollment
 */
export default async function MfaSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    redirect('/login?returnTo=/app/settings/mfa')
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Autenticação em dois fatores</h1>
        <p className="text-base text-[color:var(--ev-text-muted)]">
          MFA reforça a segurança da sua conta. Profissionais de saúde devem habilitar
          (regra 43 do LogiFit + ADR 0073).
        </p>
      </header>

      <section
        aria-labelledby="totp-section"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <h2 id="totp-section" className="text-xl font-semibold">
          App autenticador (TOTP)
        </h2>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Use Google Authenticator, Microsoft Authenticator, Authy ou 1Password.
        </p>
        <p className="text-sm rounded-md border border-dashed border-[color:var(--ev-border)] p-3 text-[color:var(--ev-text-muted)]">
          Enrollment completo entra na Sprint 01a Faixa D (depende de página de
          settings + email para enviar QR code link).
        </p>
      </section>

      <section
        aria-labelledby="passkey-section"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <h2 id="passkey-section" className="text-xl font-semibold">
          Passkey (WebAuthn)
        </h2>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Use Face ID, Touch ID, Windows Hello ou chave física (YubiKey).
        </p>
        <p className="text-sm rounded-md border border-dashed border-[color:var(--ev-border)] p-3 text-[color:var(--ev-text-muted)]">
          Disponível a partir do Sprint 02 (plugin passkey BetterAuth).
        </p>
      </section>

      <section
        aria-labelledby="recovery-section"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <h2 id="recovery-section" className="text-xl font-semibold">
          Códigos de recuperação
        </h2>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          10 códigos one-time pra recuperar acesso se perder seu autenticador.
          Mostrados <strong>UMA vez</strong> ao habilitar MFA.
        </p>
      </section>
    </main>
  )
}
