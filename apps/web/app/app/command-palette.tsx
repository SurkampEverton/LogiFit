'use client'

/**
 * `<CommandPalette>` — atalho Ctrl+K / Cmd+K (Sprint 07 Faixa C MVP).
 *
 * MVP: lista estática de ações + rotas filtradas por substring no label.
 * Sprint 07+ Faixa D plugga `search_index` tabela (ADR 0062) com FTS Postgres
 * pra incluir Pessoas, Members, Agendamentos.
 *
 * Atalhos:
 *   - Ctrl+K / Cmd+K → abre
 *   - Esc → fecha
 *   - ↑/↓ navega; Enter executa
 *   - `>` ações; `/` rotas (MVP: tudo misturado, filtro só por substring)
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

interface CommandItem {
  id: string
  label: string
  hint?: string
  href?: string
  emoji: string
  category: 'navigation' | 'action' | 'data'
}

/** Resultado do GET /api/search (search_index — ADR 0062 fase 1). */
interface SearchApiResult {
  kind: string
  label: string
  subtitle: string | null
  url: string
  isSensitive: boolean
}

const SEARCH_KIND_EMOJI: Record<string, string> = {
  person: '📇',
  member: '👥',
  fiscal_emission: '🧾',
}

const CANONICAL_ITEMS: CommandItem[] = [
  // Navigation
  {
    id: 'nav-dashboard',
    label: 'Dashboard',
    hint: '/app',
    href: '/app',
    emoji: '🏠',
    category: 'navigation',
  },
  {
    id: 'nav-members',
    label: 'Alunos / Pacientes',
    hint: '/app/members',
    href: '/app/members',
    emoji: '👥',
    category: 'navigation',
  },
  {
    id: 'nav-persons',
    label: 'Pessoas (PF/PJ)',
    hint: '/app/pessoas',
    href: '/app/pessoas',
    emoji: '📇',
    category: 'navigation',
  },
  {
    id: 'nav-agenda',
    label: 'Agenda',
    hint: '/app/agenda',
    href: '/app/agenda',
    emoji: '📅',
    category: 'navigation',
  },
  {
    id: 'nav-agenda-week',
    label: 'Agenda — Visão semanal',
    hint: '/app/agenda/week',
    href: '/app/agenda/week',
    emoji: '📆',
    category: 'navigation',
  },
  {
    id: 'nav-resources',
    label: 'Recursos (catraca/sala/instrutor)',
    hint: '/app/agenda/resources',
    href: '/app/agenda/resources',
    emoji: '🔧',
    category: 'navigation',
  },
  {
    id: 'nav-financeiro',
    label: 'Financeiro',
    hint: '/app/financeiro',
    href: '/app/financeiro',
    emoji: '💰',
    category: 'navigation',
  },
  {
    id: 'nav-planos',
    label: 'Planos',
    hint: '/app/financeiro/planos',
    href: '/app/financeiro/planos',
    emoji: '💼',
    category: 'navigation',
  },
  {
    id: 'nav-contratos',
    label: 'Contratos',
    hint: '/app/financeiro/contratos',
    href: '/app/financeiro/contratos',
    emoji: '📋',
    category: 'navigation',
  },
  {
    id: 'nav-cobrancas',
    label: 'Cobranças',
    hint: '/app/financeiro/cobrancas',
    href: '/app/financeiro/cobrancas',
    emoji: '🧾',
    category: 'navigation',
  },
  {
    id: 'nav-promocoes',
    label: 'Promoções',
    hint: '/app/financeiro/promocoes',
    href: '/app/financeiro/promocoes',
    emoji: '🎟️',
    category: 'navigation',
  },
  {
    id: 'nav-checkins',
    label: 'Check-ins ao vivo',
    hint: '/app/acesso/checkins',
    href: '/app/acesso/checkins',
    emoji: '🚪',
    category: 'navigation',
  },
  {
    id: 'nav-retencao',
    label: 'Retenção / Churn',
    hint: '/app/retencao',
    href: '/app/retencao',
    emoji: '🎯',
    category: 'navigation',
  },
  {
    id: 'nav-retencao-intv',
    label: 'Intervenções de retenção',
    hint: '/app/retencao/interventions',
    href: '/app/retencao/interventions',
    emoji: '📋',
    category: 'navigation',
  },
  {
    id: 'nav-recepcao',
    label: 'Dashboard Recepção',
    hint: '/app/dashboard/recepcao',
    href: '/app/dashboard/recepcao',
    emoji: '🛎️',
    category: 'navigation',
  },
  {
    id: 'nav-users',
    label: 'Usuários e roles',
    hint: '/app/settings/users',
    href: '/app/settings/users',
    emoji: '⚙️',
    category: 'navigation',
  },
  {
    id: 'nav-fiscal',
    label: 'Emissões fiscais (NFS-e/NF-e)',
    hint: '/app/fiscal',
    href: '/app/fiscal',
    emoji: '🧾',
    category: 'navigation',
  },
  {
    id: 'nav-fiscal-apuracao',
    label: 'Apuração fiscal mensal',
    hint: '/app/fiscal/apuracao',
    href: '/app/fiscal/apuracao',
    emoji: '📊',
    category: 'navigation',
  },
  {
    id: 'nav-fiscal-settings',
    label: 'Configurações fiscais (Focus NFe)',
    hint: '/app/settings/fiscal',
    href: '/app/settings/fiscal',
    emoji: '⚙️',
    category: 'navigation',
  },
  {
    id: 'nav-fiscal-catalogo',
    label: 'Catálogo de serviços tributáveis',
    hint: '/app/settings/fiscal/catalogo',
    href: '/app/settings/fiscal/catalogo',
    emoji: '📚',
    category: 'navigation',
  },
  {
    id: 'nav-contador',
    label: 'Portal do contador',
    hint: '/app/contador',
    href: '/app/contador',
    emoji: '🧮',
    category: 'navigation',
  },
  // Actions
  {
    id: 'act-new-member',
    label: 'Cadastrar novo member',
    hint: '/app/members/new',
    href: '/app/members/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-new-appointment',
    label: 'Novo agendamento',
    hint: '/app/agenda/new',
    href: '/app/agenda/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-new-plan',
    label: 'Novo plano',
    hint: '/app/financeiro/planos/new',
    href: '/app/financeiro/planos/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-new-promo',
    label: 'Nova promoção',
    hint: '/app/financeiro/promocoes/new',
    href: '/app/financeiro/promocoes/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-new-resource',
    label: 'Novo recurso (catraca/sala)',
    hint: '/app/agenda/resources/new',
    href: '/app/agenda/resources/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-new-user',
    label: 'Novo usuário',
    hint: '/app/settings/users/new',
    href: '/app/settings/users/new',
    emoji: '➕',
    category: 'action',
  },
  {
    id: 'act-emit-nfse',
    label: 'Emitir NFS-e avulsa',
    hint: '/app/fiscal/emitir/nfse',
    href: '/app/fiscal/emitir/nfse',
    emoji: '📄',
    category: 'action',
  },
]

function fuzzyMatch(query: string, label: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const l = label.toLowerCase()
  // Substring simples — Sprint 07+ pode usar Fuse.js se precisar fuzzy real
  return l.includes(q) || l.split(' ').some((w) => w.startsWith(q))
}

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const [serverItems, setServerItems] = useState<CommandItem[]>([])

  // Filtra: se query começa com `>`, só actions; `/`, só navigation; senão tudo
  const filterMode = query.startsWith('>') ? 'action' : query.startsWith('/') ? 'navigation' : 'all'
  const searchTerm = query.startsWith('>') || query.startsWith('/') ? query.slice(1).trim() : query

  const staticItems = CANONICAL_ITEMS.filter(
    (it) =>
      (filterMode === 'all' || it.category === filterMode) && fuzzyMatch(searchTerm, it.label),
  ).slice(0, 8)

  const items = filterMode === 'all' ? [...staticItems, ...serverItems].slice(0, 15) : staticItems

  // Busca server-side no search_index (ADR 0062) — debounce 200ms + abort
  useEffect(() => {
    if (filterMode !== 'all' || searchTerm.length < 2) {
      setServerItems([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      // safe-fetch-exempt: rota same-origin do próprio app (path relativo, sem host) — safeFetch existe pra SSRF em URL externa
      fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { ok: boolean; data?: { results: SearchApiResult[] } } | null) => {
          if (!body?.ok || !body.data) return
          setServerItems(
            body.data.results.map((r, i) => ({
              id: `srv-${r.kind}-${i}`,
              label: r.isSensitive ? `⚠️ ${r.label}` : r.label,
              hint: r.subtitle ?? undefined,
              href: r.url,
              emoji: SEARCH_KIND_EMOJI[r.kind] ?? '🔎',
              category: 'data' as const,
            })),
          )
        })
        .catch(() => {
          /* abort/rede — mantém resultados anteriores */
        })
    }, 200)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [searchTerm, filterMode])

  // Ctrl+K / Cmd+K abre
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Foca input quando abre
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Reset selectedIdx ao mudar query
  useEffect(() => {
    setSelectedIdx(0)
  }, [])

  function execute(item: CommandItem) {
    if (item.href) {
      setOpen(false)
      router.push(item.href)
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selectedIdx]
      if (item) execute(item)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fechar palette"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Palette */}
      {/* biome-ignore lint/a11y/useSemanticElements: <dialog> nativo muda foco/open behavior — migração fica pro Sprint 07 Faixa D junto com search_index */}
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      >
        <div
          className="w-full max-w-2xl rounded-xl border border-[color:var(--ev-border)] shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--ev-surface)' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="p-3 border-b border-[color:var(--ev-border)]">
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar… (`>` para ações, `/` para rotas)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              className="w-full bg-transparent text-base focus:outline-none px-2 py-2"
              style={{ minHeight: '44px' }}
            />
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-[color:var(--ev-text-muted)]">
                Nada encontrado — busca cobre rotas, ações, pessoas, alunos/pacientes e notas
                fiscais.
              </li>
            ) : (
              items.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => execute(item)}
                    onMouseEnter={() => setSelectedIdx(i)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                    style={{
                      backgroundColor:
                        i === selectedIdx ? 'var(--ev-surface-muted)' : 'transparent',
                      borderLeft:
                        i === selectedIdx ? '3px solid var(--ev-primary)' : '3px solid transparent',
                      minHeight: '44px',
                    }}
                  >
                    <span className="text-xl">{item.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-xs text-[color:var(--ev-text-muted)] truncate">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor:
                          item.category === 'action'
                            ? 'var(--ev-primary)'
                            : 'var(--ev-surface-muted)',
                        color:
                          item.category === 'action'
                            ? 'var(--ev-primary-foreground, white)'
                            : 'var(--ev-text-muted)',
                      }}
                    >
                      {item.category === 'action'
                        ? 'Ação'
                        : item.category === 'data'
                          ? 'Dado'
                          : 'Rota'}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="px-4 py-2 border-t border-[color:var(--ev-border)] text-xs text-[color:var(--ev-text-muted)] flex items-center justify-between">
            <span>↑↓ navegar · Enter selecionar · Esc fechar</span>
            <span className="font-mono">Ctrl+K</span>
          </div>
        </div>
      </div>
    </>
  )
}
