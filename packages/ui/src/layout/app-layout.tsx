import type { ReactNode } from 'react'

/**
 * AppLayout — esqueleto canônico de layout autenticado (regra 31 + ADR 0063).
 *
 * Sprint 00: header compacto com slot para hamburger (☰) + slot para conteúdo
 * (página ocupa 100% da largura). **Sem sidebar fixa** — navegação real vai
 * no overlay <SideMenu> do Sprint 00b.
 *
 * Touch target via tokens (regra 31 — min 44px).
 */
interface AppLayoutProps {
  children: ReactNode
  /** Slot pro <HamburgerTrigger>. Sprint 00b traz o real; aqui só placeholder. */
  hamburgerSlot?: ReactNode
}

export function AppLayout({ children, hamburgerSlot }: AppLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header
        style={{
          minHeight: 'var(--ev-touch-min, 44px)',
          backgroundColor: 'var(--ev-surface)',
          borderBottom: '1px solid var(--ev-border)',
          padding: 'var(--ev-space-2) var(--ev-space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ev-space-3)',
        }}
      >
        {hamburgerSlot ?? (
          <button
            type="button"
            aria-label="Menu"
            style={{
              minWidth: 'var(--ev-touch-min, 44px)',
              minHeight: 'var(--ev-touch-min, 44px)',
              background: 'transparent',
              border: 'none',
              color: 'var(--ev-text)',
              cursor: 'pointer',
              fontSize: 'var(--ev-text-xl)',
            }}
          >
            {'☰'}
          </button>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
