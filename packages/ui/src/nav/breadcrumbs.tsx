/**
 * `<Breadcrumbs>` — navegação hierárquica responsiva (regra 31 + ADR 0063).
 *
 * Mobile: mostra só `…` + primeiro + último item (truncado se ≥4 items)
 * Desktop: mostra todos os items com separador `/`
 *
 * Cada item pode ter `href` (link) ou não (texto puro, geralmente o último).
 * Server Component — funciona em qualquer page sem 'use client'.
 *
 * Reutilizável: padrão `Início / X / Y / Atual`. Sprint dono passa items
 * traduzidos via t().
 */
import type { ReactNode } from 'react'

export interface BreadcrumbItem {
  label: ReactNode
  href?: string
}

interface Props {
  items: BreadcrumbItem[]
  /** Label acessível pro `<nav>`. Caller traduz via `t('breadcrumbs.label')`. */
  ariaLabel?: string
  /** Em mobile, ≥ este número de items colapsa pro `… / primeiro / último`. */
  collapseAtLength?: number
}

const SEPARATOR = ' / '

export function Breadcrumbs({ items, ariaLabel = 'Navegação', collapseAtLength = 4 }: Props) {
  if (items.length === 0) return null

  const showCollapsed = items.length >= collapseAtLength
  const collapsedItems: BreadcrumbItem[] = showCollapsed
    ? [items[0]!, { label: '…' }, items[items.length - 1]!]
    : items

  return (
    <nav
      aria-label={ariaLabel}
      className="text-sm"
      style={{ color: 'var(--ev-text-muted)' }}
    >
      {/* Mobile: versão colapsada quando há muitos items */}
      <ol className="flex flex-wrap items-center sm:hidden" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {collapsedItems.map((item, idx) => (
          <li key={`m-${idx}`} className="inline-flex items-center">
            {renderItem(item)}
            {idx < collapsedItems.length - 1 && <span aria-hidden>{SEPARATOR}</span>}
          </li>
        ))}
      </ol>

      {/* Desktop: versão completa */}
      <ol className="hidden flex-wrap items-center sm:flex" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item, idx) => (
          <li key={`d-${idx}`} className="inline-flex items-center">
            {renderItem(item)}
            {idx < items.length - 1 && <span aria-hidden>{SEPARATOR}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function renderItem(item: BreadcrumbItem): ReactNode {
  if (item.href) {
    // <a> simples (Server Component compatível). Em apps Next, caller pode
    // passar items pré-renderizados com <Link> via ReactNode em `label` se
    // precisar de prefetch — geralmente breadcrumb não justifica.
    return (
      <a
        href={item.href}
        style={{ color: 'inherit', textDecoration: 'none' }}
        className="hover:underline"
      >
        {item.label}
      </a>
    )
  }
  return <span style={{ color: 'var(--ev-text)' }}>{item.label}</span>
}
