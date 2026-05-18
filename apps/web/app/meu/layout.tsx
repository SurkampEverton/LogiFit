/**
 * Portal do Paciente Layout — Sprint 26 Faixa C.
 *
 * Wraps `/meu/*` em chrome mobile-first com bottom nav. Distinto de `/app/*`
 * (sem SideMenu, sem CommandPalette, sem AssistantFAB — paciente não é staff).
 *
 * **PWA-ready (Sprint 26):**
 *   - <link rel="manifest"> apontando pro `/meu/manifest.json`
 *   - safe-area-inset respeitado (notch + home indicator)
 *   - bottom nav fixo com 4 ícones: Agenda, Financeiro, Treino, Mais
 *
 * **Rotas autenticadas:** `/meu` (home) e filhas requerem session.
 * **Rotas públicas dentro de /meu:** `/meu/login`, `/meu/login/verify`.
 * Layout NÃO chama `requireMemberSession()` no root — cada page autenticada
 * faz isso individualmente (login/verify precisam renderizar sem session).
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { RegisterSw } from './register-sw'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'LogiFit · Meu Portal',
  description: 'Portal do aluno e paciente LogiFit.',
  manifest: '/manifest.webmanifest',
  themeColor: '#3498DB',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'LogiFit',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  },
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ev-portal-shell">
      <RegisterSw />
      {/* Topbar minimalista — só logo + link "sair" via menu */}
      <header className="ev-portal-topbar">
        <Link href="/meu" className="ev-portal-brand">
          LogiFit
        </Link>
      </header>

      {/* Conteúdo — padding-bottom pro bottom nav não cobrir */}
      <main className="ev-portal-main">{children}</main>

      {/* Bottom nav fixo — 4 atalhos principais (Sprint 26 MVP) */}
      <nav className="ev-portal-bottom-nav" aria-label="Navegação principal">
        <Link href="/meu/agenda" className="ev-portal-nav-item">
          <span className="ev-portal-nav-icon">📅</span>
          <span className="ev-portal-nav-label">Agenda</span>
        </Link>
        <Link href="/meu/financeiro" className="ev-portal-nav-item">
          <span className="ev-portal-nav-icon">💳</span>
          <span className="ev-portal-nav-label">Financeiro</span>
        </Link>
        <Link href="/meu/treino" className="ev-portal-nav-item">
          <span className="ev-portal-nav-icon">💪</span>
          <span className="ev-portal-nav-label">Treino</span>
        </Link>
        <Link href="/meu/perfil" className="ev-portal-nav-item">
          <span className="ev-portal-nav-icon">👤</span>
          <span className="ev-portal-nav-label">Mais</span>
        </Link>
      </nav>
    </div>
  )
}
