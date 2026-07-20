import { db } from '@repo/db/client'
import { accountsReceivable, apArPayments, chartOfAccounts, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/contas-receber/[id]` — detalhe AR + ações
 * (markIssued/registerReceived/cancel). Sprint 15 Faixa C.
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { ARActions } from './ar-actions'

export const dynamic = 'force-dynamic'

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

export default async function ARDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/contas-receber/${id}`)
  const tenantId = session.logifit.tenantId

  const [ar] = await db
    .select({
      id: accountsReceivable.id,
      companyId: accountsReceivable.companyId,
      payerPersonId: accountsReceivable.payerPersonId,
      chartAccountId: accountsReceivable.chartAccountId,
      amountCents: accountsReceivable.amountCents,
      receivedAmountCents: accountsReceivable.receivedAmountCents,
      issueDate: accountsReceivable.issueDate,
      dueDate: accountsReceivable.dueDate,
      description: accountsReceivable.description,
      docNumber: accountsReceivable.docNumber,
      status: accountsReceivable.status,
      receivedAt: accountsReceivable.receivedAt,
      payerName: persons.name,
      payerDocument: persons.document,
      chartCode: chartOfAccounts.code,
      chartName: chartOfAccounts.name,
    })
    .from(accountsReceivable)
    .leftJoin(persons, eq(persons.id, accountsReceivable.payerPersonId))
    .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsReceivable.chartAccountId))
    .where(and(eq(accountsReceivable.id, id), eq(accountsReceivable.tenantId, tenantId)))
    .limit(1)

  if (!ar) notFound()

  const receipts = await db
    .select({
      id: apArPayments.id,
      amountCents: apArPayments.amountCents,
      paidAt: apArPayments.paidAt,
      method: apArPayments.method,
      reference: apArPayments.reference,
      notes: apArPayments.notes,
    })
    .from(apArPayments)
    .where(and(eq(apArPayments.sourceType, 'ar'), eq(apArPayments.sourceId, id)))
    .orderBy(desc(apArPayments.paidAt))

  const badge = STATUS_BADGE[ar.status]!
  const receivedTotal = receipts.reduce((s, p) => s + p.amountCents, 0)
  const remaining = ar.amountCents - receivedTotal

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>AR {ar.docNumber ?? ar.id.slice(0, 8)}</h1>
        <span
          className="ev-badge"
          style={{ backgroundColor: badge.bg, color: badge.fg, fontSize: 'var(--ev-font-sm)' }}
        >
          {badge.label}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/contas-receber" className="ev-btn ev-btn-ghost">
          ← Contas a receber
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Valor</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(ar.amountCents)}
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
            {formatBrl(receivedTotal)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>A receber</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: remaining > 0 ? 'var(--ev-warning, #92400e)' : 'inherit',
            }}
          >
            {formatBrl(remaining)}
          </div>
        </div>
      </div>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h3 style={{ marginTop: 0 }}>Dados</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, margin: 0 }}>
          <dt style={{ color: 'var(--ev-muted)' }}>Pagador</dt>
          <dd style={{ margin: 0 }}>{ar.payerName ?? '—'}</dd>
          <dt style={{ color: 'var(--ev-muted)' }}>Conta</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: 'var(--ev-font-xs)' }}>{ar.chartCode}</code> {ar.chartName}
          </dd>
          <dt style={{ color: 'var(--ev-muted)' }}>Emissão</dt>
          <dd style={{ margin: 0 }}>{ar.issueDate}</dd>
          <dt style={{ color: 'var(--ev-muted)' }}>Vencimento</dt>
          <dd style={{ margin: 0 }}>{ar.dueDate}</dd>
          <dt style={{ color: 'var(--ev-muted)' }}>Doc Nº</dt>
          <dd style={{ margin: 0 }}>{ar.docNumber ?? '—'}</dd>
        </dl>
        {ar.description && (
          <p style={{ marginTop: 'var(--ev-space-md)', whiteSpace: 'pre-wrap' }}>
            {ar.description}
          </p>
        )}
      </section>

      <ARActions arId={ar.id} status={ar.status} />

      {receipts.length > 0 && (
        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <header
            style={{
              padding: 'var(--ev-space-md)',
              borderBottom: '1px solid var(--ev-border)',
            }}
          >
            <h3 style={{ margin: 0 }}>Recebimentos</h3>
          </header>
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Método</th>
                <th style={{ textAlign: 'left' }}>Referência</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.paidAt).toLocaleDateString('pt-BR')}</td>
                  <td>{p.method.toUpperCase()}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{p.reference ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{formatBrl(p.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
