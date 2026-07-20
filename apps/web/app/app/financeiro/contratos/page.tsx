import { db } from '@repo/db/client'
import { contracts, members, persons, plans } from '@repo/db/schema'
/**
 * `/app/financeiro/contratos` — lista contratos do tenant (Sprint 04 Faixa C).
 *
 * MVP: lista plana com filtro `?status=`. Sprint 04+ Faixa D adiciona detail
 * `/[id]` com linha do tempo de cobranças + ações cancel/applyDiscount.
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  paused: 'Trancado',
  cancelled: 'Cancelado',
  expired: 'Expirado',
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--ev-success, #10b981)',
  paused: 'var(--ev-warning, #f59e0b)',
  cancelled: 'var(--ev-text-muted)',
  expired: 'var(--ev-text-muted)',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await requireFullSession('/app/financeiro/contratos')
  const params = await searchParams
  const statusFilter = params.status

  const conditions = [eq(contracts.tenantId, session.logifit.tenantId)]
  if (statusFilter && ['active', 'paused', 'cancelled', 'expired'].includes(statusFilter)) {
    conditions.push(
      eq(contracts.status, statusFilter as 'active' | 'paused' | 'cancelled' | 'expired'),
    )
  }

  const rows = await db
    .select({
      id: contracts.id,
      status: contracts.status,
      startedAt: contracts.startedAt,
      endsAt: contracts.endsAt,
      billingDay: contracts.billingDay,
      memberId: contracts.memberId,
      planName: plans.name,
      planPriceCents: plans.priceCents,
      personName: persons.name,
    })
    .from(contracts)
    .innerJoin(plans, eq(plans.id, contracts.planId))
    .innerJoin(members, eq(members.id, contracts.memberId))
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(...conditions))
    .orderBy(desc(contracts.startedAt))
    .limit(200)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app/financeiro" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Financeiro
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Contratos</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Members ↔ planos vigentes — preço congelado no momento da contratação.
        </p>
      </header>

      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-[color:var(--ev-text-muted)]">Filtrar:</span>
        <Link
          href="/app/financeiro/contratos"
          className={
            !statusFilter
              ? 'font-medium text-[color:var(--ev-primary)]'
              : 'text-[color:var(--ev-text-muted)] hover:underline'
          }
        >
          Todos
        </Link>
        {Object.keys(STATUS_LABEL).map((s) => (
          <Link
            key={s}
            href={`/app/financeiro/contratos?status=${s}`}
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
            Nenhum contrato{' '}
            {statusFilter ? `com status "${STATUS_LABEL[statusFilter]}"` : 'cadastrado'}.
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
                <th className="px-4 py-3 font-medium">Início</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/app/members/${c.memberId}`} className="hover:underline">
                      {c.personName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.planName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatBRL(c.planPriceCents)}</td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(c.startedAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-medium"
                      style={{ color: STATUS_COLOR[c.status] ?? 'var(--ev-text)' }}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
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
