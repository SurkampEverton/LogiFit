import { db } from '@repo/db/client'
import { accountsReceivable, chartOfAccounts, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/contas-receber` — AR avulso (Sprint 15 Faixa C).
 *
 * AR avulso = recebimento não vinculado a contrato (aluguel recebido, venda
 * esporádica, reembolso). Mensalidade de contrato vai em `invoices` (Sprint 04).
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  from?: string
  to?: string
}

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--ev-muted-bg, #e5e7eb)', fg: 'var(--ev-muted, #6b7280)', label: 'Rascunho' },
  issued: { bg: 'var(--ev-info-bg, #dbeafe)', fg: 'var(--ev-info, #1e40af)', label: 'Emitida' },
  received: {
    bg: 'var(--ev-success-bg, #dcfce7)',
    fg: 'var(--ev-success, #16a34a)',
    label: 'Recebida',
  },
  overdue: {
    bg: 'var(--ev-danger-bg, #fee2e2)',
    fg: 'var(--ev-danger, #dc2626)',
    label: 'Em atraso',
  },
  cancelled: {
    bg: 'var(--ev-muted-bg, #e5e7eb)',
    fg: 'var(--ev-muted, #6b7280)',
    label: 'Cancelada',
  },
  refunded: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Estornada',
  },
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function ARListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/financeiro/contas-receber')
  const tenantId = session.logifit.tenantId

  const where = [eq(accountsReceivable.tenantId, tenantId)]
  if (params.status) where.push(eq(accountsReceivable.status, params.status as 'draft'))
  if (params.from) where.push(gte(accountsReceivable.dueDate, params.from))
  if (params.to) where.push(lte(accountsReceivable.dueDate, params.to))

  const rows = await db
    .select({
      id: accountsReceivable.id,
      payerPersonId: accountsReceivable.payerPersonId,
      chartAccountId: accountsReceivable.chartAccountId,
      amountCents: accountsReceivable.amountCents,
      receivedAmountCents: accountsReceivable.receivedAmountCents,
      issueDate: accountsReceivable.issueDate,
      dueDate: accountsReceivable.dueDate,
      description: accountsReceivable.description,
      docNumber: accountsReceivable.docNumber,
      status: accountsReceivable.status,
      payerName: persons.name,
      chartCode: chartOfAccounts.code,
      chartName: chartOfAccounts.name,
    })
    .from(accountsReceivable)
    .leftJoin(persons, eq(persons.id, accountsReceivable.payerPersonId))
    .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsReceivable.chartAccountId))
    .where(and(...where))
    .orderBy(asc(accountsReceivable.dueDate))
    .limit(200)

  const totalReceber = rows
    .filter((r) => ['draft', 'issued', 'overdue'].includes(r.status))
    .reduce((s, r) => s + r.amountCents, 0)
  const totalRecebido = rows
    .filter((r) => r.status === 'received')
    .reduce((s, r) => s + (r.receivedAmountCents ?? r.amountCents), 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Contas a receber (avulso)</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} lançamentos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/contas-receber/new" className="ev-btn ev-btn-primary">
          + Novo recebível
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        AR avulso é para recebimentos sem contrato (aluguel, venda esporádica, reembolso).
        Mensalidade de contrato fica em <Link href="/app/financeiro/cobrancas">Cobranças</Link>.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>A receber</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalReceber)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Recebido</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(totalRecebido)}
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
            <option value="issued">Emitida</option>
            <option value="received">Recebida</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>De</span>
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
            Nenhum recebível encontrado.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Vencimento</th>
                <th style={{ textAlign: 'left' }}>Pagador</th>
                <th style={{ textAlign: 'left' }}>Descrição</th>
                <th style={{ textAlign: 'left' }}>Status</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = STATUS_BADGE[row.status]!
                return (
                  <tr key={row.id}>
                    <td>{row.dueDate}</td>
                    <td>{row.payerName ?? '—'}</td>
                    <td>
                      <Link href={`/app/financeiro/contas-receber/${row.id}`}>
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
                    <td style={{ textAlign: 'right' }}>{formatBrl(row.amountCents)}</td>
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
