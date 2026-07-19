/**
 * Layout do portal do contador externo — Sprint 36b.6 (ADR 0061).
 *
 * Distinto do AppShell staff: sem SideMenu operacional, sem Copilot, sem
 * acesso a members/agenda/prontuário. Navegação própria enxuta + **cabeçalho
 * obrigatório "Leitura somente"** (sprint doc: escopo LGPD mínimo — dados
 * fiscais e financeiros, nunca clínicos).
 *
 * Acesso: permission `fiscal.read` (contador_externo tem só ela; staff com
 * fiscal.read também pode entrar pra conferência).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasPermission } from '../../lib/permissions'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const NAV = [
  { href: '/app/contador', label: '📊 Visão geral' },
  { href: '/app/contador/fiscal-emissions', label: '🧾 Notas emitidas' },
]

export default async function ContadorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireFullSession('/app/contador')
  if (!(await hasPermission(session.logifit.userId, 'fiscal.read'))) {
    redirect('/app')
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="ev-banner ev-banner--info"
        style={{ borderRadius: 0, position: 'sticky', top: 0, zIndex: 10 }}
      >
        <span className="ev-banner__icon" aria-hidden="true">
          🔒
        </span>
        <div className="ev-banner__body">
          <p className="ev-banner__title">Portal do contador — leitura somente</p>
          <p className="ev-banner__description">
            Dados fiscais e financeiros; sem acesso clínico ou operacional. Tenant:{' '}
            {session.logifit.tenantName}
          </p>
        </div>
        <nav className="ev-banner__actions" aria-label="Navegação do contador">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="ev-btn ev-btn-sm">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  )
}
