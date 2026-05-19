/**
 * /meu/login — login do portal do paciente. Sprint 26 (magic link) +
 * Sprint 02b3 (password — ADR 0094).
 *
 * 2 abas:
 *   - **Senha** (Sprint 02b3 padrão): email + password + opcional TOTP
 *     (passport_global_sessions) — pra pacientes que fizeram /cadastro proativo
 *   - **Magic link** (Sprint 26 legacy): email só + recebe link 15min
 *     (member_sessions) — pra pacientes existentes sem identity global ainda
 *
 * Switcher client-side via state. Sprint 02b4 pode unificar: tentar password
 * silently + fallback magic link.
 */
import Link from 'next/link'
import { headers } from 'next/headers'
import { LoginTabs } from './login-tabs'

export const dynamic = 'force-dynamic'

export default async function MeuLoginPage() {
  // Resolve tenant slug do subdomínio (ADR 0065) pra magic link
  const h = await headers()
  const host = h.get('host') ?? ''
  const slug = host.split('.')[0] ?? 'default'

  return (
    <div className="ev-portal-page ev-portal-login">
      <h1 className="ev-portal-h1">Acesse seu portal</h1>
      <p className="ev-portal-muted">
        Entre com sua conta LogiFit ou peça um link mágico por email.
      </p>

      <LoginTabs tenantSlug={slug} />

      <p
        style={{
          marginTop: 'var(--ev-space-lg)',
          fontSize: 'var(--ev-text-xs)',
          color: 'var(--ev-text-muted)',
          textAlign: 'center',
        }}
      >
        Ainda não tem conta?{' '}
        <Link href="/cadastro">Cadastre-se →</Link>
      </p>
    </div>
  )
}
