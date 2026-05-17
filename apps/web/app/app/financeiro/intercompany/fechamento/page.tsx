/**
 * `/app/financeiro/intercompany/fechamento` — fechamento mensal IC (Sprint 16 Faixa C).
 *
 * Mostra saldos por par de companies + período + estatísticas mensais.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { companies, intercompanyEntries, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  from?: string
  to?: string
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function firstOfMonth(): string {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function lastOfMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

export default async function ICFechamentoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/financeiro/intercompany/fechamento')
  const tenantId = session.logifit.tenantId

  const from = params.from ?? firstOfMonth()
  const to = params.to ?? lastOfMonth()

  const compRows = await db
    .select({ id: companies.id, name: persons.name })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
  const nameById = new Map(compRows.map((c) => [c.id, c.name ?? '—']))

  const pairs = await db
    .select({
      fromCompanyId: intercompanyEntries.fromCompanyId,
      toCompanyId: intercompanyEntries.toCompanyId,
      totalCents: sql<number>`SUM(${intercompanyEntries.amountCents})::bigint`,
      count: sql<number>`COUNT(*)::int`,
      pendingCents: sql<number>`COALESCE(SUM(${intercompanyEntries.amountCents}) FILTER (WHERE ${intercompanyEntries.settledAt} IS NULL), 0)::bigint`,
      settledCents: sql<number>`COALESCE(SUM(${intercompanyEntries.amountCents}) FILTER (WHERE ${intercompanyEntries.settledAt} IS NOT NULL), 0)::bigint`,
    })
    .from(intercompanyEntries)
    .where(
      and(
        eq(intercompanyEntries.tenantId, tenantId),
        gte(intercompanyEntries.createdAt, new Date(from + 'T00:00:00Z')),
        lte(intercompanyEntries.createdAt, new Date(to + 'T23:59:59Z')),
      ),
    )
    .groupBy(intercompanyEntries.fromCompanyId, intercompanyEntries.toCompanyId)
    .orderBy(sql`SUM(${intercompanyEntries.amountCents}) DESC`)

  const totalPeriod = pairs.reduce((s, p) => s + Number(p.totalCents), 0)
  const totalPending = pairs.reduce((s, p) => s + Number(p.pendingCents), 0)
  const totalSettled = pairs.reduce((s, p) => s + Number(p.settledCents), 0)
  const settledRate = totalPeriod > 0 ? Math.round((totalSettled / totalPeriod) * 100) : 0

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Fechamento Intercompany</h1>
        <span style={{ color: 'var(--ev-muted)' }}>
          {from} → {to}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/intercompany" className="ev-btn ev-btn-ghost">
          ← Intercompany
        </Link>
      </header>

      <form
        method="GET"
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'flex',
          gap: 'var(--ev-space-sm)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Desde</span>
          <input type="date" name="from" defaultValue={from} className="ev-input" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Até</span>
          <input type="date" name="to" defaultValue={to} className="ev-input" />
        </label>
        <button type="submit" className="ev-btn ev-btn-ghost">
          Aplicar
        </button>
      </form>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Total no período
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalPeriod)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Liquidado</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(totalSettled)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Pendente</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: totalPending > 0 ? 'var(--ev-warning, #92400e)' : 'inherit',
            }}
          >
            {formatBrl(totalPending)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Taxa de liquidação
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{settledRate}%</div>
        </div>
      </div>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <header
          style={{
            padding: 'var(--ev-space-md)',
            borderBottom: '1px solid var(--ev-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Saldos por par</h2>
        </header>
        {pairs.length === 0 ? (
          <p style={{ padding: 'var(--ev-space-md)', margin: 0, color: 'var(--ev-muted)' }}>
            Nenhum lançamento IC no período.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>De</th>
                <th></th>
                <th style={{ textAlign: 'left' }}>Para</th>
                <th style={{ textAlign: 'right' }}>Entries</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Liquidado</th>
                <th style={{ textAlign: 'right' }}>Pendente</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={`${p.fromCompanyId}-${p.toCompanyId}`}>
                  <td>{nameById.get(p.fromCompanyId) ?? '—'}</td>
                  <td style={{ textAlign: 'center', color: 'var(--ev-muted)' }}>→</td>
                  <td>{nameById.get(p.toCompanyId) ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{p.count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(Number(p.totalCents))}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: 'var(--ev-success, #16a34a)',
                    }}
                  >
                    {formatBrl(Number(p.settledCents))}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color:
                        Number(p.pendingCents) > 0
                          ? 'var(--ev-warning, #92400e)'
                          : 'inherit',
                      fontWeight: Number(p.pendingCents) > 0 ? 600 : 400,
                    }}
                  >
                    {formatBrl(Number(p.pendingCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
