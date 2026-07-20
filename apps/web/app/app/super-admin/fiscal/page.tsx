/**
 * `/app/super-admin/fiscal` — conta Focus NFe da plataforma (ADR 0105).
 *
 * Só `super_admin` da LogiFit: o token aqui gerencia empresas na conta Focus
 * da plataforma, e nenhum papel de tenant deve alcançá-lo. O gate é repetido
 * na Server Action (defesa em profundidade — esconder a página não protege o
 * endpoint).
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../lib/session'
import { getPlatformFiscalStatus } from './actions'
import { PlatformTokenForm } from './platform-token-form'

export const dynamic = 'force-dynamic'

export default async function PlatformFiscalPage() {
  const session = await requireFullSession('/app/super-admin/fiscal')
  // 404 em vez de 403: não confirma a existência da tela pra quem não deve vê-la.
  if (!session.logifit?.roles.includes('super_admin')) notFound()

  const status = await getPlatformFiscalStatus({})
  const data = status.ok ? status.data : null

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Conta Focus NFe da plataforma</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/settings/fiscal" className="ev-btn ev-btn-ghost">
          Configurações fiscais do tenant →
        </Link>
      </header>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        {data?.configured ? (
          <p style={{ marginTop: 0 }}>
            <strong>Configurado</strong> · ambiente {data.environment} ·{' '}
            <span style={{ color: 'var(--ev-text-muted)' }}>
              validado em{' '}
              {data.lastValidatedAt
                ? new Date(data.lastValidatedAt).toLocaleString('pt-BR')
                : 'nunca'}{' '}
              · {data.lastValidationStatus ?? '—'}
            </span>
          </p>
        ) : (
          <p style={{ marginTop: 0 }}>
            Nenhum token de conta configurado. Enquanto não houver, tenants sem cadastro próprio não
            conseguem gravar dados de empresa na Focus.
          </p>
        )}

        <PlatformTokenForm
          configured={Boolean(data?.configured)}
          currentEnvironment={data?.configured ? data.environment : null}
        />
      </section>

      <p style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
        Tenant com conta própria na Focus liga o flag <em>cadastro próprio</em> em Configurações →
        Fiscal e informa o token dele; nesse caso este token não é usado para aquele tenant.
      </p>
    </div>
  )
}
