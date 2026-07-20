import { db } from '@repo/db/client'
import { contracts, invoices, members, persons, plans } from '@repo/db/schema'
/**
 * `/app/financeiro/cobrancas` — lista invoices do tenant (Sprint 04 Faixa C).
 *
 * MVP: lista plana com filtro `?status=` + ordem por due_at desc.
 * Sprint 04+ Faixa D adiciona detail + ações reissue/applyDiscount.
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Paga',
  overdue: 'Em atraso',
  cancelled: 'Cancelada',
  refunded: 'Estornada',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--ev-warning, #f59e0b)',
  paid: 'var(--ev-success, #10b981)',
  overdue: 'var(--ev-danger, #ef4444)',
  cancelled: 'var(--ev-text-muted)',
  refunded: 'var(--ev-text-muted)',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function CobrancasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await requireFullSession('/app/financeiro/cobrancas')
  const params = await searchParams
  const statusFilter = params.status

  const conditions = [eq(invoices.tenantId, session.logifit.tenantId)]
  if (
    statusFilter &&
    ['pending', 'paid', 'overdue', 'cancelled', 'refunded'].includes(statusFilter)
  ) {
    conditions.push(
      eq(
        invoices.status,
        statusFilter as 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded',
      ),
    )
  }

  const rows = await db
    .select({
      id: invoices.id,
      amountCents: invoices.amountCents,
      dueAt: invoices.dueAt,
      paidAt: invoices.paidAt,
      status: invoices.status,
      asaasId: invoices.asaasId,
      memberId: invoices.memberId,
      personName: persons.name,
      planName: plans.name,
    })
    .from(invoices)
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(plans, eq(plans.id, contracts.planId))
    .innerJoin(members, eq(members.id, invoices.memberId))
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(...conditions))
    .orderBy(desc(invoices.dueAt))
    .limit(200)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app/financeiro" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Financeiro
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Cobranças</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Invoices emitidas pelo sistema — sincronizadas com Asaas via webhook.
        </p>
      </header>

      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-[color:var(--ev-text-muted)]">Filtrar:</span>
        <Link
          href="/app/financeiro/cobrancas"
          className={
            !statusFilter
              ? 'font-medium text-[color:var(--ev-primary)]'
              : 'text-[color:var(--ev-text-muted)] hover:underline'
          }
        >
          Todas
        </Link>
        {Object.keys(STATUS_LABEL).map((s) => (
          <Link
            key={s}
            href={`/app/financeiro/cobrancas?status=${s}`}
            className={
              statusFilter === s
                ? 'font-medium text-[color:var(--ev-primary)]'
                : 'text-[color:var(--ev-text-muted)] hover:underline'
            }
          >
            {STATUS_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">
            Nenhuma cobrança {statusFilter ? `${STATUS_LABEL[statusFilter]}` : 'emitida'}.
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Plano</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Vencimento</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Asaas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/app/members/${inv.memberId}`} className="hover:underline">
                      {inv.personName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">{inv.planName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatBRL(inv.amountCents)}</td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(inv.dueAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-medium"
                      style={{ color: STATUS_COLOR[inv.status] ?? 'var(--ev-text)' }}
                    >
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--ev-text-muted)] font-mono">
                    {inv.asaasId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
