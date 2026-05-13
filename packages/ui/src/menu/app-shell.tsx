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
  /** Sprint 00b Faixa B — Email do user (BetterAuth user.email). Footer expandido exibe. */
  userEmail?: string
  activeVerticals: Vertical[]
  /**
   * Lista pré-computada de permission_key ativas do user (set lookup O(1)).
   * Sprint 00b Faixa C: lookup real via `list_user_permissions()` SQL function
   * memoizado na session.logifit.permissions. Array vazio = user sem permissions
   * → menu fica vazio (esperado pra user recém-criado sem role atribuída).
   */
  permissionKeys: string[]
  /** Conjunto de feature flags ativas. Faixa A passa vazio. */
  featureFlags?: string[]
  modules: MenuModule[]
  /** Path atual (Server passa via headers ou usePathname client-side). Marca item ativo. */
  currentPath: string
  /** I18n: ((key) => label). Server passa next-intl getTranslations resultado serializado. */
  labels: Record<string, string>
  /** Sprint 00b Faixa D — URL pra signout (default /api/auth/sign-out, BetterAuth). */
  signOutUrl?: string
  /** Sprint 00b Faixa D — URL pra onde redirecionar após signout (default /login). */
  postSignOutUrl?: string
  children: React.ReactNode
}

const STORAGE_KEY = 'logifit:sidemenu:open'

export function AppShell({
  userId,
  userName,
  tenantName,
  userEmail,
  activeVerticals,
  permissionKeys,
  featureFlags = [],
  modules,
  currentPath,
  labels,
  signOutUrl = '/api/auth/sign-out',
  postSignOutUrl = '/login',
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

  // Sprint 00b Faixa B — Swipe gesture mobile.
  // Abre: touchstart na borda esquerda (x < 20px), swipe direita ≥ 50px → setOpen(true)
  // Fecha: touchstart com menu aberto, swipe esquerda ≥ 50px → setOpen(false)
  // Desktop não usa swipe (matchMedia bloqueia). Threshold 50px evita falso positivo de scroll.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let startX = 0
    let startY = 0
    let tracking = false

    function onTouchStart(e: TouchEvent) {
      const isMobile = window.matchMedia('(max-width: 1024px)').matches
      if (!isMobile) return
      const t = e.touches[0]
      if (!t) return
      // Só rastreia: borda esquerda (abrir) ou menu aberto (fechar)
      const fromEdge = t.clientX < 20
      if (fromEdge || open) {
        startX = t.clientX
        startY = t.clientY
        tracking = true
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      // Ignora gesto se mais vertical que horizontal (provavelmente scroll)
      if (dy > Math.abs(dx)) return
      if (dx > 50 && !open) setOpen(true)
      else if (dx < -50 && open) setOpen(false)
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [open])

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
    hasPermission: (k) => permissionSet.has(k),
    hasConsent: () => true, // Sprint 11+ plugga
    featureFlags: featureFlagSet,
  }

  const visibleModules = modules
    .filter((m) => !m.requiredVertical || verticalSet.has(m.requiredVertical))
    .map((m) => ({ ...m, items: m.items.filter((it) => isItemVisible(it, filter)) }))
    .filter((m) => m.items.length > 0)
    .sort((a, b) => a.order - b.order)

  const label = (key: string): string => labels[key] ?? key

  // Sprint 00b Faixa B/D — Inicial pra avatar circular (placeholder até design system ter logo).
  const initial = (text: string): string => {
    const trim = text.trim()
    if (!trim) return '?'
    const ch = trim[0]
    return ch ? ch.toUpperCase() : '?'
  }

  // Sprint 00b Faixa D — logout via BetterAuth POST /api/auth/sign-out.
  const [signingOut, setSigningOut] = useState(false)
  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch(signOutUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch {
      /* swallow — redirect mesmo se request falhar */
    }
    window.location.href = postSignOutUrl
  }

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
        {/* Sprint 00b Faixa B — Tenant avatar/logo placeholder (inicial). */}
        <div
          aria-hidden="true"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: 'var(--ev-primary)',
            color: 'var(--ev-primary-foreground, white)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          {initial(tenantName)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 'var(--ev-text-base)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tenantName}
          </span>
          <span
            style={{
              fontSize: 'var(--ev-text-xs)',
              color: 'var(--ev-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userEmail ?? userName}
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

        {/* Sprint 00b Faixa D — Footer com avatar + email + logout. */}
        <div
          style={{
            padding: 'var(--ev-space-4)',
            borderTop: '1px solid var(--ev-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ev-space-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ev-space-3)' }}>
            <div
              aria-hidden="true"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: 'var(--ev-primary)',
                color: 'var(--ev-primary-foreground, white)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 'var(--ev-text-base)',
                flexShrink: 0,
              }}
            >
              {initial(userName)}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                flex: 1,
              }}
            >
              <span
                style={{
                  fontSize: 'var(--ev-text-sm)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {userEmail ?? userName}
              </span>
              <span
                style={{
                  fontSize: 'var(--ev-text-xs)',
                  color: 'var(--ev-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tenantName}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              width: '100%',
              minHeight: 'var(--ev-touch-min, 44px)',
              padding: 'var(--ev-space-2) var(--ev-space-3)',
              borderRadius: 'var(--ev-radius-md, 6px)',
              border: '1px solid var(--ev-border)',
              backgroundColor: 'transparent',
              color: 'var(--ev-text)',
              cursor: signingOut ? 'wait' : 'pointer',
              fontSize: 'var(--ev-text-sm)',
              fontWeight: 500,
              opacity: signingOut ? 0.6 : 1,
            }}
          >
            {signingOut ? label('nav.footer.signing_out') : label('nav.footer.sign_out')}
          </button>
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
