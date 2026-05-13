/**
 * `/app/financeiro` — visão geral financeiro (Sprint 04 Faixa C).
 *
 * KPIs MVP: MRR mês, total overdue, receita 30d, contratos ativos.
 * Server Component agrega via SQL — sem hit em listMembers/etc.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { contracts, invoices } from '@repo/db/schema'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function FinanceiroPage() {
  const session = await requireFullSession('/app/financeiro')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last30d = new Date(now)
  last30d.setDate(now.getDate() - 30)

  const [activeContracts, paidThisMonth, overdueTotal, last30dRevenue] = await Promise.all([
    // Contratos ativos
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.status, 'active'))),
    // MRR (sum amount_cents pago no mês)
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
    // Overdue total
    db
      .select({
        sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'overdue'))),
    // Receita 30d
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
  ])

  const kpis = [
    {
      label: 'Contratos ativos',
      value: String(activeContracts[0]?.count ?? 0),
      hint: 'Members com contrato `active`',
    },
    {
      label: 'Receita do mês',
      value: formatBRL(paidThisMonth[0]?.sum ?? 0),
      hint: 'Invoices `paid` neste mês',
    },
    {
      label: 'Em atraso',
      value: formatBRL(overdueTotal[0]?.sum ?? 0),
      hint: `${overdueTotal[0]?.count ?? 0} invoice(s) overdue`,
      danger: (overdueTotal[0]?.count ?? 0) > 0,
    },
    {
      label: 'Receita 30d',
      value: formatBRL(last30dRevenue[0]?.sum ?? 0),
      hint: 'Pagas nos últimos 30 dias',
    },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Sprint 04 — Planos, contratos, cobranças. Cobranças automáticas D-5 + webhook Asaas.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/app/financeiro/planos"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Planos
          </Link>
          <Link
            href="/app/financeiro/contratos"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Contratos
          </Link>
          <Link
            href="/app/financeiro/cobrancas"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Cobranças
          </Link>
        </div>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1"
            style={{
              borderColor: k.danger ? 'var(--ev-danger)' : undefined,
            }}
          >
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              {k.label}
            </div>
            <div
              className="text-2xl font-semibold"
              style={{ color: k.danger ? 'var(--ev-danger)' : undefined }}
            >
              {k.value}
            </div>
            <div className="text-xs text-[color:var(--ev-text-muted)]">{k.hint}</div>
          </div>
        ))}
      </section>
    </div>
  )
}
