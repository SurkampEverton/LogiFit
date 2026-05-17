/**
 * `/app/financeiro/custos` — lista de custos do tenant (Sprint 14 Faixa C).
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  companies,
  costCategories,
  costEntries,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  category?: string
  company?: string
}

const TYPE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  fixed: {
    bg: 'var(--ev-info-bg, #dbeafe)',
    fg: 'var(--ev-info, #1e40af)',
    label: 'Fixo',
  },
  variable: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Variável',
  },
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function CustosListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/financeiro/custos')
  const tenantId = session.logifit.tenantId

  const conditions = [eq(costEntries.tenantId, tenantId)]
  if (params.category) conditions.push(eq(costEntries.categoryId, params.category))
  if (params.company) conditions.push(eq(costEntries.companyId, params.company))

  const rows = await db
    .select({
      id: costEntries.id,
      amountCents: costEntries.amountCents,
      incurredAt: costEntries.incurredAt,
      description: costEntries.description,
      categoryName: costCategories.name,
      categoryType: costCategories.type,
      categoryIcon: costCategories.icon,
      companyName: persons.name,
    })
    .from(costEntries)
    .leftJoin(costCategories, eq(costCategories.id, costEntries.categoryId))
    .leftJoin(companies, eq(companies.id, costEntries.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(and(...conditions))
    .orderBy(desc(costEntries.incurredAt))
    .limit(200)

  const total = rows.reduce((acc, r) => acc + r.amountCents, 0)

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Custos operacionais</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} lançamentos · total {formatBrl(total)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/app/financeiro/custos/categorias"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Categorias
          </Link>
          <Link
            href="/app/financeiro/custos/recorrentes"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Recorrentes
          </Link>
          <Link
            href="/app/financeiro/dre"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            DRE
          </Link>
          <Link
            href="/app/financeiro/previsao"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Previsão
          </Link>
          <Link
            href="/app/financeiro/custos/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo custo
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhum custo lançado ainda. Comece em <Link href="/app/financeiro/custos/categorias" className="underline">Categorias</Link>{' '}
          → depois <Link href="/app/financeiro/custos/new" className="underline">Novo custo</Link>.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const badge = c.categoryType && TYPE_BADGE[c.categoryType]
            return (
              <li
                key={c.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-3 flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">
                    {c.categoryIcon ?? '💼'} {c.categoryName ?? '(removida)'}
                    {badge && (
                      <span
                        className="ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide align-middle"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    {c.companyName ?? 'sem company'} ·{' '}
                    {new Date(c.incurredAt).toLocaleDateString('pt-BR')}
                  </div>
                  {c.description && (
                    <p className="text-xs text-[color:var(--ev-text-muted)] italic mt-1 line-clamp-1">
                      {c.description}
                    </p>
                  )}
                </div>
                <div className="font-semibold tabular-nums">{formatBrl(c.amountCents)}</div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
