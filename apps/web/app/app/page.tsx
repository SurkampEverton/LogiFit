/**
 * `/app` — Dashboard "Equilíbrio Vital" (Sprint 07).
 *
 * KPIs tenant-wide via aggregate queries em paralelo + atalhos contextuais.
 * Sprint 07+ Faixa B (não no escopo): role-aware dashboards
 * (recepção/gerente/diretor/group_owner) em `/app/dashboard/{role}`.
 *
 * Cross-alert dispatcher: tabela `alert_subscribers` criada (vazia MVP).
 * Sprint 13+ régua de comunicação popula.
 */
import { db } from '@repo/db/client'
import {
  appointments,
  contracts,
  invoices,
  members,
} from '@repo/db/schema'
import { and, count, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../lib/session'

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
  href?: string
}

function KpiCard({ label, value, hint, danger, href }: KpiCardProps) {
  const content = (
    <div
      className="rounded-xl border p-5 space-y-1 transition-colors hover:bg-[color:var(--ev-surface)]"
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
  return href ? <Link href={href}>{content}</Link> : content
}

export default async function AppHomePage() {
  const session = await requireFullSession('/app')
  const tenantId = session.logifit.tenantId
  const claims = session.logifit
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last30d = new Date(now)
  last30d.setDate(now.getDate() - 30)
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay)
  endOfDay.setDate(startOfDay.getDate() + 1)
  const next7d = new Date(now)
  next7d.setDate(now.getDate() + 7)

  // KPIs cross-module em paralelo
  const [
    memberCount,
    activeContracts,
    mrr,
    overdue,
    revenue30d,
    appointmentsToday,
    appointments7d,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), isNull(members.archivedAt))),
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
      .select({ sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, last30d),
        ),
      ),
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          gte(appointments.startsAt, startOfDay),
          lte(appointments.startsAt, endOfDay),
        ),
      ),
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
  ])

  const overdueCount = overdue[0]?.count ?? 0
  const overdueSum = overdue[0]?.sum ?? 0

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Olá, {claims.username}
        </h1>
        <p className="text-[color:var(--ev-text-muted)]">
          Dashboard "Equilíbrio Vital" — KPIs do tenant em tempo (quase) real.
        </p>
      </header>

      {/* KPIs principais */}
      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <KpiCard
          label="Alunos ativos"
          value={String(memberCount[0]?.n ?? 0)}
          hint="Members não-arquivados"
          href="/app/members"
        />
        <KpiCard
          label="Contratos ativos"
          value={String(activeContracts[0]?.n ?? 0)}
          hint="Status active"
          href="/app/financeiro/contratos"
        />
        <KpiCard
          label="Receita do mês"
          value={formatBRL(mrr[0]?.sum ?? 0)}
          hint="Invoices pagas neste mês"
          href="/app/financeiro/cobrancas?status=paid"
        />
        <KpiCard
          label="Em atraso"
          value={formatBRL(overdueSum)}
          hint={`${overdueCount} invoice(s) overdue`}
          danger={overdueCount > 0}
          href="/app/financeiro/cobrancas?status=overdue"
        />
        <KpiCard
          label="Receita 30d"
          value={formatBRL(revenue30d[0]?.sum ?? 0)}
          hint="Pagas últimos 30 dias"
          href="/app/financeiro/cobrancas?status=paid"
        />
        <KpiCard
          label="Agenda hoje"
          value={String(appointmentsToday[0]?.n ?? 0)}
          hint="Agendamentos do dia"
          href="/app/agenda/week"
        />
        <KpiCard
          label="Agenda 7 dias"
          value={String(appointments7d[0]?.n ?? 0)}
          hint="Próximos 7 dias"
          href="/app/agenda"
        />
      </section>

      {/* Atalhos */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Atalhos rápidos
        </h2>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          <Link
            href="/app/members/new"
            className="rounded-md border border-[color:var(--ev-border)] p-3 text-sm hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            👤 Novo member
          </Link>
          <Link
            href="/app/agenda/new"
            className="rounded-md border border-[color:var(--ev-border)] p-3 text-sm hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            📅 Novo agendamento
          </Link>
          <Link
            href="/app/financeiro/planos/new"
            className="rounded-md border border-[color:var(--ev-border)] p-3 text-sm hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            💼 Novo plano
          </Link>
          <Link
            href="/app/financeiro/promocoes/new"
            className="rounded-md border border-[color:var(--ev-border)] p-3 text-sm hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            🎟️ Nova promoção
          </Link>
        </div>
      </section>

      {/* Roadmap restante */}
      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm">
        <div className="font-semibold mb-2">Em desenvolvimento</div>
        <ul className="space-y-1 text-[color:var(--ev-text-muted)] list-disc pl-6">
          <li>🤖 Assistente IA universal (Sprint 06 — 10% schemas done)</li>
          <li>🚪 Controle de acesso Academia (Sprint 08)</li>
          <li>🏆 Engajamento (Sprint 09)</li>
          <li>📊 Dashboards role-aware /app/dashboard/recepcao|gerente|diretor (Sprint 07 Faixa B+)</li>
          <li>🔍 Command Palette Ctrl+K (Sprint 07 Faixa C)</li>
        </ul>
      </section>
    </div>
  )
}
