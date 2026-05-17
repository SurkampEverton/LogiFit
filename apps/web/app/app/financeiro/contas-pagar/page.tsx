/**
 * `/app/financeiro/contas-pagar` — lista de AP filtrável (Sprint 15 Faixa C).
 *
 * Filtros: status, supplier (search), company, due range.
 */
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  accountsPayable,
  chartOfAccounts,
  persons,
  suppliers,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  supplier?: string
  from?: string
  to?: string
}

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--ev-muted-bg, #e5e7eb)', fg: 'var(--ev-muted, #6b7280)', label: 'Rascunho' },
  pending_approval: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Aguardando',
  },
  approved: { bg: 'var(--ev-info-bg, #dbeafe)', fg: 'var(--ev-info, #1e40af)', label: 'Aprovada' },
  rejected: {
    bg: 'var(--ev-danger-bg, #fee2e2)',
    fg: 'var(--ev-danger, #dc2626)',
    label: 'Rejeitada',
  },
  scheduled: { bg: 'var(--ev-info-bg, #dbeafe)', fg: 'var(--ev-info, #1e40af)', label: 'Agendada' },
  paid: { bg: 'var(--ev-success-bg, #dcfce7)', fg: 'var(--ev-success, #16a34a)', label: 'Paga' },
  cancelled: { bg: 'var(--ev-muted-bg, #e5e7eb)', fg: 'var(--ev-muted, #6b7280)', label: 'Cancelada' },
  reconciled: {
    bg: 'var(--ev-success-bg, #dcfce7)',
    fg: 'var(--ev-success, #16a34a)',
    label: 'Conciliada',
  },
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function APListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/financeiro/contas-pagar')
  const tenantId = session.logifit.tenantId

  const where = [eq(accountsPayable.tenantId, tenantId)]
  if (params.status) where.push(eq(accountsPayable.status, params.status as 'draft'))
  if (params.supplier) where.push(eq(accountsPayable.supplierId, params.supplier))
  if (params.from) where.push(gte(accountsPayable.dueDate, params.from))
  if (params.to) where.push(lte(accountsPayable.dueDate, params.to))

  const rows = await db
    .select({
      id: accountsPayable.id,
      supplierId: accountsPayable.supplierId,
      chartAccountId: accountsPayable.chartAccountId,
      amountCents: accountsPayable.amountCents,
      netAmountCents: accountsPayable.netAmountCents,
      issueDate: accountsPayable.issueDate,
      dueDate: accountsPayable.dueDate,
      description: accountsPayable.description,
      docNumber: accountsPayable.docNumber,
      status: accountsPayable.status,
      paidAt: accountsPayable.paidAt,
      supplierName: persons.name,
      chartCode: chartOfAccounts.code,
      chartName: chartOfAccounts.name,
    })
    .from(accountsPayable)
    .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
    .leftJoin(persons, eq(persons.id, suppliers.personId))
    .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsPayable.chartAccountId))
    .where(and(...where))
    .orderBy(asc(accountsPayable.dueDate))
    .limit(200)

  // Agregações simples
  const totalPagar = rows
    .filter((r) => ['pending_approval', 'approved', 'scheduled'].includes(r.status))
    .reduce((s, r) => s + r.netAmountCents, 0)
  const totalAtrasado = rows
    .filter(
      (r) =>
        ['pending_approval', 'approved', 'scheduled'].includes(r.status) &&
        r.dueDate < new Date().toISOString().slice(0, 10),
    )
    .reduce((s, r) => s + r.netAmountCents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Contas a pagar</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} lançamentos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/aging" className="ev-btn ev-btn-ghost">
          Aging
        </Link>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/contas-pagar/new" className="ev-btn ev-btn-primary">
          + Nova AP
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>A pagar</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalPagar)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Em atraso</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: totalAtrasado > 0 ? 'var(--ev-danger, #dc2626)' : 'inherit',
            }}
          >
            {formatBrl(totalAtrasado)}
          </div>
        </div>
      </div>

      <form
        method="GET"
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'flex',
          gap: 'var(--ev-space-sm)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Status</span>
          <select name="status" defaultValue={params.status ?? ''} className="ev-input">
            <option value="">Todos</option>
            <option value="draft">Rascunho</option>
            <option value="pending_approval">Aguardando aprovação</option>
            <option value="approved">Aprovadas</option>
            <option value="scheduled">Agendadas</option>
            <option value="paid">Pagas</option>
            <option value="rejected">Rejeitadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Vencimento desde</span>
          <input type="date" name="from" defaultValue={params.from ?? ''} className="ev-input" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Até</span>
          <input type="date" name="to" defaultValue={params.to ?? ''} className="ev-input" />
        </label>
        <button type="submit" className="ev-btn ev-btn-ghost">
          Filtrar
        </button>
      </form>

      <div className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <p style={{ padding: 'var(--ev-space-lg)', margin: 0, color: 'var(--ev-muted)' }}>
            Nenhuma AP no filtro atual.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Vencimento</th>
                <th style={{ textAlign: 'left' }}>Fornecedor</th>
                <th style={{ textAlign: 'left' }}>Conta</th>
                <th style={{ textAlign: 'left' }}>Descrição</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = STATUS_BADGE[row.status]!
                const overdue =
                  ['pending_approval', 'approved', 'scheduled'].includes(row.status) &&
                  row.dueDate < new Date().toISOString().slice(0, 10)
                return (
                  <tr key={row.id}>
                    <td
                      style={{
                        color: overdue ? 'var(--ev-danger, #dc2626)' : 'inherit',
                        fontWeight: overdue ? 600 : 400,
                      }}
                    >
                      {row.dueDate}
                    </td>
                    <td>{row.supplierName ?? '—'}</td>
                    <td style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                      <code>{row.chartCode}</code> {row.chartName}
                    </td>
                    <td>
                      <Link href={`/app/financeiro/contas-pagar/${row.id}`}>
                        {row.description ?? row.docNumber ?? '—'}
                      </Link>
                    </td>
                    <td>
                      <span
                        className="ev-badge"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatBrl(row.netAmountCents)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
