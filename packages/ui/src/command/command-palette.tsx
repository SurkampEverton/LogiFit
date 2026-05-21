'use client'

/**
 * `<CommandPalette>` — pesquisa global (Ctrl/Cmd+K) — scaffolding (ADR 0062 + regra 30).
 *
 * **Sprint 00 scaffolding:** overlay + input + slot de resultados.
 * **Sprint 07** conecta no schema `search_index` (PostgreSQL trgm + unaccent)
 * via Server Action `searchGlobal({ q })` — substitui `onSearch` mock.
 *
 * UX:
 *   - Atalho global `Ctrl+K` (Win/Linux) / `Cmd+K` (Mac) abre
 *   - `Esc` fecha
 *   - Click no backdrop fecha
 *   - `↑/↓` navega resultados (futuro — Sprint 07)
 *   - `Enter` ativa item selecionado
 *
 * Render via `<dialog>` HTML5 nativo (mesma estratégia de ConfirmDialog):
 * herda focus trap, ESC e a11y.
 *
 * @example
 *   // app/layout.tsx
 *   import { CommandPalette, CommandPaletteProvider } from '@repo/ui'
 *   <CommandPaletteProvider>
 *     {children}
 *     <CommandPalette
 *       placeholder={t('search.placeholder')}
 *       onSearch={(q) => searchGlobal({ q })}
 *     />
 *   </CommandPaletteProvider>
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

// ─── Context + hook + provider ──────────────────────────────────────────

interface CommandPaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const Ctx = createContext<CommandPaletteState | null>(null)

export function useCommandPalette(): CommandPaletteState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  return ctx
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((v) => !v), [])

  // Atalho global Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>
}

// ─── Componente ─────────────────────────────────────────────────────────

export interface CommandPaletteResult {
  id: string
  label: ReactNode
  description?: ReactNode
  href?: string
  onSelect?: () => void
  /** Categoria pra agrupamento futuro (Sprint 07). */
  kind?: string
}

interface Props {
  placeholder?: string
  /** Mock pra scaffolding — Sprint 07 substitui por SA `searchGlobal`. */
  onSearch?: (query: string) => Promise<CommandPaletteResult[]> | CommandPaletteResult[]
}

export function CommandPalette({ placeholder = 'Buscar…', onSearch }: Props) {
  const { open, setOpen } = useCommandPalette()
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CommandPaletteResult[]>([])
  const [loading, setLoading] = useState(false)
  const titleId = useId()

  // Sync open ↔ dialog.showModal()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      setTimeout(() => inputRef.current?.focus(), 0)
    } else if (!open && dialog.open) {
      dialog.close()
      setQuery('')
      setResults([])
    }
  }, [open])

  // Search com debounce simples (250ms)
  useEffect(() => {
    if (!onSearch || query.trim().length === 0) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const r = await onSearch(query.trim())
        if (!cancelled) setResults(r)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, onSearch])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onClose={() => setOpen(false)}
      onClick={(e) => {
        if (e.target === dialogRef.current) setOpen(false)
      }}
      style={{
        border: '1px solid var(--ev-border)',
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
        padding: 0,
        margin: 'auto',
        width: '90vw',
        maxWidth: '640px',
        borderRadius: 'var(--ev-radius-md, 8px)',
      }}
    >
      <h2 id={titleId} className="sr-only">
        {placeholder}
      </h2>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%',
          padding: 'var(--ev-space-3, 12px) var(--ev-space-4, 16px)',
          background: 'transparent',
          color: 'var(--ev-text)',
          border: 'none',
          borderBottom: '1px solid var(--ev-border)',
          outline: 'none',
          fontSize: 'var(--ev-text-base, 16px)',
        }}
      />
      <div
        style={{
          maxHeight: '60vh',
          overflowY: 'auto',
          padding: 'var(--ev-space-2, 8px)',
        }}
      >
        {loading && (
          <p
            className="text-sm"
            style={{ padding: 'var(--ev-space-3)', color: 'var(--ev-text-muted)' }}
          >
            Buscando…
          </p>
        )}
        {!loading && query.length > 0 && results.length === 0 && (
          <p
            className="text-sm"
            style={{ padding: 'var(--ev-space-3)', color: 'var(--ev-text-muted)' }}
          >
            Nenhum resultado para "{query}".
          </p>
        )}
        {!loading && query.length === 0 && (
          <p
            className="text-sm"
            style={{ padding: 'var(--ev-space-3)', color: 'var(--ev-text-muted)' }}
          >
            Digite pra buscar. Ctrl+K abre · Esc fecha.
          </p>
        )}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (r.href) window.location.href = r.href
                  else if (r.onSelect) r.onSelect()
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ev-text)',
                  padding: 'var(--ev-space-2, 8px) var(--ev-space-3, 12px)',
                  cursor: 'pointer',
                  borderRadius: 'var(--ev-radius-sm, 6px)',
                  minHeight: 'var(--ev-touch-min, 44px)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--ev-bg)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={{ fontWeight: 500 }}>{r.label}</div>
                {r.description && (
                  <div className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                    {r.description}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  )
}
