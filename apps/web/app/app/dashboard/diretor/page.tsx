import { db } from '@repo/db/client'
import { companies, contracts, invoices, members, persons } from '@repo/db/schema'
/**
 * `/app/dashboard/diretor` — dashboard diretor tenant (Sprint 07 Faixa D).
 *
 * Visão tenant-wide cross-company: MRR consolidado + ranking de companies
 * por receita + tendência 6m.
 */
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function DashboardDiretorPage() {
  const session = await requireFullSession('/app/dashboard/diretor')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last90d = new Date(now)
  last90d.setDate(now.getDate() - 90)

  // 6 últimos meses pra mini-trend
  const monthBuckets = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return {
      label: d.toLocaleDateString('pt-BR', { month: 'short' }),
      start: d,
      end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
    }
  }).reverse()

  const [totalMembers, totalContracts, mrr, revenueByCompany, monthlyRevenue] = await Promise.all([
    db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), sql`archived_at IS NULL`)),
    db
      .select({ n: count() })
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.status, 'active'))),
    db
      .select({ sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, startOfMonth),
        ),
      ),
    db
      .select({
        companyId: invoices.companyId,
        companyName: persons.name,
        sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .innerJoin(companies, eq(companies.id, invoices.companyId))
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, last90d),
        ),
      )
      .groupBy(invoices.companyId, persons.name)
      .orderBy(desc(sql`sum(${invoices.amountCents})`))
      .limit(10),
    // 6 meses paralelos
    Promise.all(
      monthBuckets.map(async ({ start, end }) => {
        const r = await db
          .select({ sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
          .from(invoices)
          .where(
            and(
              eq(invoices.tenantId, tenantId),
              eq(invoices.status, 'paid'),
              gte(invoices.paidAt, start),
              sql`${invoices.paidAt} < ${end}`,
            ),
          )
        return r[0]?.sum ?? 0
      }),
    ),
  ])

  const maxRevenue = Math.max(...monthlyRevenue, 1)

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <nav className="text-sm">
        <Link href="/app" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Dashboard
        </Link>
      </nav>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Diretor</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Visão tenant-wide consolidada — todas as companies + tendência 6m.
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Total members ativos
          </div>
          <div className="text-2xl font-semibold tabular-nums">{totalMembers[0]?.n ?? 0}</div>
        </div>
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Contratos ativos
          </div>
          <div className="text-2xl font-semibold tabular-nums">{totalContracts[0]?.n ?? 0}</div>
        </div>
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            MRR (mês corrente)
          </div>
          <div className="text-2xl font-semibold tabular-nums">{formatBRL(mrr[0]?.sum ?? 0)}</div>
        </div>
      </section>

      {/* Tendência 6 meses */}
      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold">📈 Tendência 6 meses</h2>
        <div className="grid grid-cols-6 gap-2 items-end" style={{ height: '140px' }}>
          {monthBuckets.map((m, i) => {
            const v = monthlyRevenue[i] ?? 0
            const pct = Math.max(5, (v / maxRevenue) * 100)
            return (
              <div key={m.label} className="flex flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-[color:var(--ev-text-muted)]">
                  {formatBRL(v)}
                </span>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${pct}%`,
                    backgroundColor:
                      i === monthBuckets.length - 1
                        ? 'var(--ev-primary)'
                        : 'var(--ev-surface-muted)',
                  }}
                />
                <span className="text-xs text-[color:var(--ev-text-muted)]">{m.label}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Ranking companies */}
      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold">🏢 Ranking por company (90 dias)</h2>
        {revenueByCompany.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
            Sem invoices pagas nos últimos 90 dias.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
            {revenueByCompany.map((c) => (
              <li key={c.companyId} className="py-2 flex items-center justify-between gap-3">
                <span className="font-medium">{c.companyName}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[color:var(--ev-text-muted)] tabular-nums">
                    {c.count} cobrança{c.count === 1 ? '' : 's'}
                  </span>
                  <span className="font-medium tabular-nums">{formatBRL(c.sum)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
