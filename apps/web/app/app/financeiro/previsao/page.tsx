/**
 * `/app/financeiro/previsao` — projeção de receita (Sprint 14 Faixa C).
 *
 * Mostra forecast 3 meses por default + intervalo low/high (-15%/+10%).
 * Simulador interativo (sliders churn/baseline) adiado Sprint 14+.
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { forecastRevenueAction } from '../custos/actions'

export const dynamic = 'force-dynamic'

interface SearchParams {
  months?: string
  churn?: string
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function PrevisaoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  await requireFullSession('/app/financeiro/previsao')

  const monthsAhead = Math.min(12, Math.max(1, Number(params.months ?? 3) || 3))
  const manualChurn = params.churn ? Math.min(1, Math.max(0, Number(params.churn) / 100)) : undefined

  const result = await forecastRevenueAction({ monthsAhead, manualChurnRate: manualChurn })
  const data = result.ok ? result.data : null
  const err = !result.ok ? result.error.message : null

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Previsão de receita</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Projeção {monthsAhead} meses · baseline = contratos ativos × valor do plano
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
          <span className="block font-medium">Meses</span>
          <select
            name="months"
            defaultValue={String(monthsAhead)}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="3">3 meses</option>
            <option value="6">6 meses</option>
            <option value="12">12 meses</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Churn manual (%)</span>
          <input
            type="number"
            name="churn"
            min="0"
            max="50"
            step="0.5"
            defaultValue={params.churn ?? ''}
            placeholder="(usa histórico)"
            className="w-32 rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Projetar
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

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Baseline mensal
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-2">
                {formatBrl(data.baselineMonthlyCents)}
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                {data.activeContracts} contratos ativos
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Churn aplicado
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-2">
                {(data.churnRate * 100).toFixed(2)}%
              </div>
              <div className="text-[10px] text-[color:var(--ev-text-muted)] mt-1">
                {manualChurn !== undefined ? 'manual' : 'histórico 6 meses'}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5">
              <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                Total projetado ({monthsAhead}m)
              </div>
              <div
                className="text-2xl font-semibold tabular-nums mt-2"
                style={{ color: 'var(--ev-success, #22c55e)' }}
              >
                {formatBrl(data.forecast.totalProjectedCents)}
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
              Projeção mês a mês
            </h2>
            {data.forecast.monthly.length === 0 ? (
              <p className="text-sm text-[color:var(--ev-text-muted)] italic">
                Sem contratos ativos ou parâmetros inválidos.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[color:var(--ev-text-muted)] uppercase border-b border-[color:var(--ev-border)]">
                    <th className="text-left py-2">Mês</th>
                    <th className="text-right py-2">Pessimista (-15%)</th>
                    <th className="text-right py-2">Projetado</th>
                    <th className="text-right py-2">Otimista (+10%)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.monthly.map((m) => (
                    <tr
                      key={m.monthOffset}
                      className="border-b border-[color:var(--ev-border)]"
                    >
                      <td className="py-2">+{m.monthOffset} mês{m.monthOffset > 1 ? 'es' : ''}</td>
                      <td className="py-2 text-right tabular-nums text-[color:var(--ev-text-muted)]">
                        {formatBrl(m.lowCents)}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatBrl(m.projectedCents)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[color:var(--ev-text-muted)]">
                        {formatBrl(m.highCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-[color:var(--ev-text-muted)]">
              Heurística simples: baseline × (1 - churn)^N. Modelo preditivo (família A
              Gemini LLM ou família B sklearn) aterrissa em Sprint 19 via ADR 0027.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
