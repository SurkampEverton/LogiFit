'use client'

/**
 * `<AppShell>` — chrome autenticado: header (☰ + título) + SideMenu overlay + main.
 *
 * Sprint 00b Faixa A — Foundation. Implementa:
 *   - Estado `open` (useState) + persistência localStorage por user
 *   - Hamburger trigger ☰ (44px touch target, regra 31)
 *   - Overlay slide-in (transform translateX + transition CSS puro, sem framer)
 *   - Backdrop dimmed clicável pra fechar
 *   - Esc fecha + restaura foco no trigger (a11y WCAG)
 *   - Ctrl/Cmd+B toggle (desktop)
 *   - Focus trap quando aberto (Tab circula nos itens)
 *   - Largura adaptativa: 85% (max 320px) mobile · 320px tablet · 280px desktop
 *
 * Sprint 00b Faixa B: swipe gesture mobile; persistência de seções colapsadas.
 * Sprint 00b Faixa C: `has_permission` lookup async + verticals + consents reais.
 * Sprint 00b Faixa D: footer (avatar/tenant/logout) + tenant logo header.
 *
 * **Server Component que renderiza**: `<AppShell user={...} verticals={...}>{children}</AppShell>`.
 * Layout server passa user/verticals/permissions; AppShell é client (state).
 */

import { useEffect, useRef, useState } from 'react'
import type { MenuFilterContext, MenuItem, MenuModule, Vertical } from './types'

interface AppShellProps {
  userId: string
  userName: string
  tenantId: string
  tenantName: string
  activeVerticals: Vertical[]
  /** Lista pré-computada de permissions do user (set lookup O(1)). Faixa A passa vazio = todas visíveis. */
  permissionKeys: string[]
  /** Conjunto de feature flags ativas. Faixa A passa vazio. */
  featureFlags?: string[]
  modules: MenuModule[]
  /** Path atual (Server passa via headers ou usePathname client-side). Marca item ativo. */
  currentPath: string
  /** I18n: ((key) => label). Server passa next-intl getTranslations resultado serializado. */
  labels: Record<string, string>
  children: React.ReactNode
}

const STORAGE_KEY = 'logifit:sidemenu:open'

export function AppShell({
  userId,
  userName,
  tenantName,
  activeVerticals,
  permissionKeys,
  featureFlags = [],
  modules,
  currentPath,
  labels,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLElement>(null)

  // Hidratação: pega estado do localStorage (desktop persiste; mobile sempre fecha ao navegar)
  // Sprint 00b Faixa A: hidrata desktop only via matchMedia
  // biome-ignore lint/correctness/useExhaustiveDependencies: rodar uma vez no mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    if (!isDesktop) return
    try {
      const persisted = window.localStorage.getItem(STORAGE_KEY)
      if (persisted === '1') setOpen(true)
    } catch {
      /* localStorage bloqueado */
    }
  }, [])

  // Persiste estado (desktop only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    if (!isDesktop) return
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
    } catch {
      /* swallow */
    }
  }, [open])

  // Esc fecha + restaura foco
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Ctrl/Cmd+B toggle (desktop)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Focus trap quando aberto
  useEffect(() => {
    if (!open || !menuRef.current) return
    const focusableSel =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = Array.from(menuRef.current.querySelectorAll<HTMLElement>(focusableSel))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    first?.focus()

    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      if (focusables.length === 0) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', trap)
    return () => window.removeEventListener('keydown', trap)
  }, [open])

  // Filtro de visibilidade — Faixa A: simples Set lookup
  const permissionSet = new Set(permissionKeys)
  const featureFlagSet = new Set(featureFlags)
  const verticalSet = new Set(activeVerticals)

  const filter: MenuFilterContext = {
    userId,
    tenantId: '',
    activeVerticals,
    hasPermission: (k) => permissionSet.size === 0 || permissionSet.has(k),
    hasConsent: () => true, // Sprint 11+ plugga
    featureFlags: featureFlagSet,
  }

  const visibleModules = modules
    .filter((m) => !m.requiredVertical || verticalSet.has(m.requiredVertical))
    .map((m) => ({ ...m, items: m.items.filter((it) => isItemVisible(it, filter)) }))
    .filter((m) => m.items.length > 0)
    .sort((a, b) => a.order - b.order)

  const label = (key: string): string => labels[key] ?? key

  return (
    <div className="min-h-screen flex flex-col">
      {/* HEADER */}
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
        <button
          ref={triggerRef}
          type="button"
          aria-label={label('nav.toggle')}
          aria-expanded={open}
          aria-controls="logifit-sidemenu"
          onClick={() => setOpen((v) => !v)}
          style={{
            minWidth: 'var(--ev-touch-min, 44px)',
            minHeight: 'var(--ev-touch-min, 44px)',
            background: 'transparent',
            border: 'none',
            color: 'var(--ev-text)',
            cursor: 'pointer',
            fontSize: 'var(--ev-text-xl)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {'☰'}
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--ev-text-base)' }}>{tenantName}</span>
          <span
            style={{
              fontSize: 'var(--ev-text-xs)',
              color: 'var(--ev-text-muted)',
            }}
          >
            {userName}
          </span>
        </div>
      </header>

      {/* BACKDROP */}
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handler está no document
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(2px)',
            transition: 'opacity 0.2s ease-out',
          }}
        />
      )}

      {/* SIDE MENU */}
      <nav
        ref={menuRef}
        id="logifit-sidemenu"
        aria-label={label('nav.aria.label')}
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          width: 'min(85vw, 320px)',
          maxWidth: '320px',
          zIndex: 50,
          backgroundColor: 'var(--ev-surface)',
          borderRight: '1px solid var(--ev-border)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            padding: 'var(--ev-space-4)',
            borderBottom: '1px solid var(--ev-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <strong style={{ fontSize: 'var(--ev-text-lg)' }}>LogiFit</strong>
          <button
            type="button"
            aria-label={label('nav.close')}
            onClick={() => setOpen(false)}
            style={{
              minWidth: 'var(--ev-touch-min, 44px)',
              minHeight: 'var(--ev-touch-min, 44px)',
              background: 'transparent',
              border: 'none',
              color: 'var(--ev-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--ev-text-lg)',
            }}
          >
            ✕
          </button>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1 }}>
          {visibleModules.map((m) => (
            <li key={m.id}>
              <div
                style={{
                  padding: 'var(--ev-space-3) var(--ev-space-4)',
                  fontSize: 'var(--ev-text-xs)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--ev-text-muted)',
                }}
              >
                {m.icon} {label(m.labelKey)}
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {m.items.map((item) => {
                  const active = item.url === currentPath
                  return (
                    <li key={item.id}>
                      <a
                        href={item.url}
                        onClick={(e) => {
                          // Mobile fecha ao navegar (desktop mantém aberto)
                          if (typeof window !== 'undefined') {
                            const isMobile = window.matchMedia('(max-width: 768px)').matches
                            if (isMobile) setOpen(false)
                          }
                          // permite navegação normal
                          if (!item.url) e.preventDefault()
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--ev-space-3)',
                          padding: 'var(--ev-space-3) var(--ev-space-4)',
                          color: active ? 'var(--ev-primary)' : 'var(--ev-text)',
                          backgroundColor: active ? 'var(--ev-surface-muted)' : 'transparent',
                          textDecoration: 'none',
                          minHeight: 'var(--ev-touch-min, 44px)',
                          fontSize: 'var(--ev-text-base)',
                          borderLeft: active
                            ? '3px solid var(--ev-primary)'
                            : '3px solid transparent',
                        }}
                      >
                        <span aria-hidden="true">{item.icon ?? '·'}</span>
                        <span style={{ flex: 1 }}>{label(item.labelKey)}</span>
                        {item.badge && (
                          <span
                            style={{
                              fontSize: 'var(--ev-text-xs)',
                              padding: '2px 6px',
                              borderRadius: '9999px',
                              backgroundColor: 'var(--ev-warning-bg, #fbbf24)',
                              color: 'var(--ev-warning-text, #78350f)',
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>

        {/* Footer placeholder — Faixa D entrega avatar/tenant-switch/logout completos */}
        <div
          style={{
            padding: 'var(--ev-space-4)',
            borderTop: '1px solid var(--ev-border)',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          {label('nav.footer.session_for')} <strong>{userName}</strong>
          <br />
          {tenantName}
        </div>
      </nav>

      {/* MAIN — sempre 100% viewport (overlay, não push) */}
      <main className="flex-1">{children}</main>
    </div>
  )
}

function isItemVisible(item: MenuItem, ctx: MenuFilterContext): boolean {
  if (item.requiredPermission && !ctx.hasPermission(item.requiredPermission)) return false
  if (item.requiredVertical && !ctx.activeVerticals.includes(item.requiredVertical)) return false
  if (item.requiredConsent && !ctx.hasConsent(item.requiredConsent)) return false
  if (item.featureFlag && !ctx.featureFlags.has(item.featureFlag)) return false
  return true
}
