/**
 * `<ResponsiveTable>` — `<table>` em desktop ↔ `<ul>` de cards em mobile (regra 31 + ADR 0063).
 *
 * Por padrão tudo é Server Component (zero JS no client). Caller passa
 * `columns` com `priority`:
 *   - `'always'` — sempre visível (mobile + desktop)
 *   - `'md'` — esconde em <640px
 *   - `'lg'` — esconde em <1024px
 *
 * Mobile renderiza cards (uma "linha" = 1 card vertical com label: valor).
 * Desktop renderiza tabela tradicional.
 *
 * **Não substitui** componente de tabela complexa (ordenação, virtualization,
 * paginação). Pra esses casos, monte direto e use os componentes filhos
 * `<TableCard>` se quiser reaproveitar o card mobile.
 *
 * @example
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'name', label: 'Nome', priority: 'always' },
 *       { key: 'cpf', label: 'CPF', priority: 'md', render: (r) => maskCpf(r.cpf) },
 *       { key: 'phone', label: 'Telefone', priority: 'lg' },
 *     ]}
 *     rows={members}
 *     getRowKey={(r) => r.id}
 *     emptyState={<p>{t('members.empty')}</p>}
 *   />
 */
import type { ReactNode } from 'react'

export type ColumnPriority = 'always' | 'md' | 'lg'

export interface Column<T> {
  key: string
  label: ReactNode
  priority?: ColumnPriority
  /** Render custom da célula. Sem isso, usa `String(row[column.key])`. */
  render?: (row: T) => ReactNode
  /** Alinhamento do conteúdo. Default `left`. */
  align?: 'left' | 'center' | 'right'
}

interface Props<T> {
  columns: ReadonlyArray<Column<T>>
  rows: ReadonlyArray<T>
  getRowKey: (row: T) => string
  emptyState?: ReactNode
  /** Label acessível da tabela. */
  ariaLabel?: string
  /** Border colapsável visual entre rows (default true). */
  divided?: boolean
}

function visibilityClass(priority: ColumnPriority): string {
  switch (priority) {
    case 'md':
      return 'hidden md:table-cell'
    case 'lg':
      return 'hidden lg:table-cell'
    default:
      return ''
  }
}

function mobileVisibilityClass(priority: ColumnPriority): string {
  // Em mobile (card), sempre mostra todas pra não esconder info.
  // Tradeoff intencional: card é vertical, espaço sobra; tabela é horizontal, espaço falta.
  return priority === 'lg' ? 'sm:hidden' : ''
}

function defaultCellRender<T>(row: T, column: Column<T>): ReactNode {
  if (column.render) return column.render(row)
  const value = (row as Record<string, unknown>)[column.key]
  if (value === null || value === undefined) return '—'
  return String(value)
}

export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  emptyState,
  ariaLabel,
  divided = true,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed p-8 text-center text-sm"
        style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
      >
        {emptyState ?? '—'}
      </div>
    )
  }

  return (
    <>
      {/* Desktop: tabela */}
      <div
        className="hidden overflow-x-auto rounded-md border sm:block"
        style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
      >
        <table className="w-full text-sm" aria-label={ariaLabel}>
          <thead>
            <tr
              className="border-b text-left"
              style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
            >
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2 font-medium text-xs uppercase tracking-wide ${visibilityClass(col.priority ?? 'always')}`}
                  style={{ textAlign: col.align ?? 'left' }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className={divided ? 'border-b last:border-b-0' : ''}
                style={{ borderColor: 'var(--ev-border)' }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 ${visibilityClass(col.priority ?? 'always')}`}
                    style={{ textAlign: col.align ?? 'left' }}
                  >
                    {defaultCellRender(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul
        className="space-y-2 sm:hidden"
        style={{ margin: 0, padding: 0, listStyle: 'none' }}
        aria-label={ariaLabel}
      >
        {rows.map((row) => (
          <li
            key={getRowKey(row)}
            className="rounded-md border p-3"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            <dl className="grid grid-cols-1 gap-2 text-sm">
              {columns
                .filter((col) => col.priority !== 'lg') // 'lg' fica oculto em mobile
                .map((col) => (
                  <div
                    key={col.key}
                    className={`flex justify-between gap-2 ${mobileVisibilityClass(col.priority ?? 'always')}`}
                  >
                    <dt
                      className="text-xs uppercase tracking-wide"
                      style={{ color: 'var(--ev-text-muted)' }}
                    >
                      {col.label}
                    </dt>
                    <dd style={{ textAlign: 'right', color: 'var(--ev-text)' }}>
                      {defaultCellRender(row, col)}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
