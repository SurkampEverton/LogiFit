import { db } from '@repo/db/client'
import { appointments, contracts, invoices, members, persons } from '@repo/db/schema'
/**
 * `/app/dashboard/gerente` — dashboard gerente de company (Sprint 07 Faixa D).
 *
 * Foco operacional + financeiro: KPIs da company + alertas operacionais
 * (overdue, no-shows, ocupação agenda 7d).
 */
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

interface KpiCardProps {
  label: string
  value: string
  hint?: string
  danger?: boolean
}

function KpiCard({ label, value, hint, danger }: KpiCardProps) {
  return (
    <div
      className="rounded-xl border p-5 space-y-1"
      style={{
        borderColor: danger ? 'var(--ev-danger)' : 'var(--ev-border)',
        minHeight: 'var(--ev-touch-min, 44px)',
      }}
    >
      <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
        {label}
      </div>
      <div
        className="text-2xl font-semibold tabular-nums"
        style={{ color: danger ? 'var(--ev-danger)' : undefined }}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-[color:var(--ev-text-muted)]">{hint}</div>}
    </div>
  )
}

export default async function DashboardGerentePage() {
  const session = await requireFullSession('/app/dashboard/gerente')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const next7d = new Date(now)
  next7d.setDate(now.getDate() + 7)
  const last30d = new Date(now)
  last30d.setDate(now.getDate() - 30)

  const [
    activeMembers,
    activeContracts,
    mrr,
    overdue,
    appointmentsNext7d,
    noShows30d,
    recentlyArchived,
  ] = await Promise.all([
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
        sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'overdue'))),
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          gte(appointments.startsAt, now),
          lte(appointments.startsAt, next7d),
        ),
      ),
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.status, 'no_show'),
          gte(appointments.startsAt, last30d),
        ),
      ),
    db
      .select({
        id: members.id,
        archivedAt: members.archivedAt,
        archiveReason: members.archiveReason,
        personName: persons.name,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(members.tenantId, tenantId), sql`archived_at IS NOT NULL`))
      .orderBy(desc(members.archivedAt))
      .limit(5),
  ])

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <nav className="text-sm">
        <Link href="/app" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Dashboard
        </Link>
      </nav>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Gerente</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          KPIs da company + alertas operacionais (overdue, no-shows, churn recente).
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <KpiCard
          label="Members ativos"
          value={String(activeMembers[0]?.n ?? 0)}
          hint="Não-arquivados"
        />
        <KpiCard
          label="Contratos ativos"
          value={String(activeContracts[0]?.n ?? 0)}
          hint="Status active"
        />
        <KpiCard
          label="Receita do mês"
          value={formatBRL(mrr[0]?.sum ?? 0)}
          hint="Invoices pagas neste mês"
        />
        <KpiCard
          label="Em atraso"
          value={formatBRL(overdue[0]?.sum ?? 0)}
          hint={`${overdue[0]?.count ?? 0} invoice(s)`}
          danger={(overdue[0]?.count ?? 0) > 0}
        />
        <KpiCard
          label="Agenda 7 dias"
          value={String(appointmentsNext7d[0]?.n ?? 0)}
          hint="Próximas semana"
        />
        <KpiCard
          label="No-shows 30d"
          value={String(noShows30d[0]?.n ?? 0)}
          hint="Member não compareceu"
          danger={(noShows30d[0]?.n ?? 0) > 10}
        />
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">📤 Members arquivados recentes</h2>
        {recentlyArchived.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">Nenhum churn recente. 🎉</p>
        ) : (
          <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
            {recentlyArchived.map((m) => (
              <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                <Link href={`/app/members/${m.id}`} className="font-medium hover:underline">
                  {m.personName}
                </Link>
                <div className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                  {m.archivedAt && new Date(m.archivedAt).toLocaleDateString('pt-BR')}
                  {m.archiveReason && ` · ${m.archiveReason}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
