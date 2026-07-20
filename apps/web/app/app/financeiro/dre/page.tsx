/**
 * `/app/financeiro/dre` — DRE interativa (Sprint 14 Faixa C).
 *
 * Server Component que invoca `generateDre` Server Action e renderiza
 * resultado. Período via search params (?from=2026-05-01&to=2026-05-31).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { generateDre } from '../custos/actions'

export const dynamic = 'force-dynamic'

interface SearchParams {
  from?: string
  to?: string
  companyId?: string
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function startOfMonth(): string {
  const d = new Date()
  d.setUTCDate(1)
  return d.toISOString().slice(0, 10)
}

function endOfMonth(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 1, 0) // último dia
  return d.toISOString().slice(0, 10)
}

export default async function DrePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  await requireFullSession('/app/financeiro/dre')

  const from = params.from ?? startOfMonth()
  const to = params.to ?? endOfMonth()

  const result = await generateDre({ from, to })
  const dre = result.ok ? result.data.dre : null
  const err = !result.ok ? result.error.message : null

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">DRE</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Demonstração de resultados {from} a {to}
          </p>
        </div>
        <Link
          href="/app/financeiro/custos"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          ← Custos
        </Link>
      </header>

      <form method="get" className="flex gap-2 flex-wrap items-end">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">De</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Até</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Gerar DRE
        </button>
      </form>

      {err && (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {err}
        </div>
      )}

      {dre && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Receita paga
              </div>
              <div
                className="text-2xl font-semibold tabular-nums mt-2"
                style={{ color: 'var(--ev-success, #22c55e)' }}
              >
                {formatBrl(dre.revenue.paidCents)}
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                {dre.counts.invoices} faturas
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Pendente
              </div>
              <div
                className="text-2xl font-semibold tabular-nums mt-2"
                style={{ color: 'var(--ev-warning, #eab308)' }}
              >
                {formatBrl(dre.revenue.pendingCents + dre.revenue.overdueCents)}
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                pending + overdue
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Custos
              </div>
              <div
                className="text-2xl font-semibold tabular-nums mt-2"
                style={{ color: 'var(--ev-danger, #ef4444)' }}
              >
                {formatBrl(dre.costs.totalCents)}
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                fixo {formatBrl(dre.costs.byType.fixedCents)} · var{' '}
                {formatBrl(dre.costs.byType.variableCents)}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Margem
              </div>
              <div
                className="text-2xl font-semibold tabular-nums mt-2"
                style={{
                  color:
                    dre.margins.grossCents >= 0
                      ? 'var(--ev-success, #22c55e)'
                      : 'var(--ev-danger, #ef4444)',
                }}
              >
                {formatBrl(dre.margins.grossCents)}
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                {dre.margins.grossPercent.toFixed(1)}% de margem bruta
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
              Custos por categoria
            </h2>
            {dre.costs.byCategory.length === 0 ? (
              <p className="text-sm text-[color:var(--ev-text-muted)] italic">
                Nenhum custo no período.
              </p>
            ) : (
              <ul className="space-y-2">
                {dre.costs.byCategory.map((c) => {
                  const percent =
                    dre.costs.totalCents > 0 ? (c.totalCents / dre.costs.totalCents) * 100 : 0
                  return (
                    <li key={c.categoryId} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">
                          {c.categoryName}
                          <span className="text-[10px] uppercase ml-2 text-[color:var(--ev-text-muted)]">
                            {c.categoryType === 'fixed' ? 'Fixo' : 'Variável'}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatBrl(c.totalCents)}{' '}
                          <span className="text-xs text-[color:var(--ev-text-muted)]">
                            ({percent.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[color:var(--ev-bg)] overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, percent)}%`,
                            backgroundColor:
                              c.categoryType === 'fixed'
                                ? 'var(--ev-info, #3b82f6)'
                                : 'var(--ev-warning, #eab308)',
                          }}
                        />
                      </div>
                      <div className="text-[10px] text-[color:var(--ev-text-muted)]">
                        {c.count} lançamento{c.count > 1 ? 's' : ''}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
