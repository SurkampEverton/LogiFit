/**
 * `/app/financeiro/contas-pagar/[id]` — detalhe AP + ações de workflow
 * (submit/approve/reject/cancel/pay manual). Sprint 15 Faixa C.
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import {
  accountsPayable,
  apArPayments,
  chartOfAccounts,
  persons,
  suppliers,
} from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { APActions } from './ap-actions'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--ev-muted-bg, #e5e7eb)', fg: 'var(--ev-muted, #6b7280)', label: 'Rascunho' },
  pending_approval: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Aguardando aprovação',
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

interface TraceEntry {
  at: string
  byUserId: string
  byRole?: string
  action: 'submitted' | 'approved' | 'rejected' | 'comment'
  comment?: string
}

export default async function APDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/contas-pagar/${id}`)
  const tenantId = session.logifit.tenantId

  const [ap] = await db
    .select({
      id: accountsPayable.id,
      companyId: accountsPayable.companyId,
      supplierId: accountsPayable.supplierId,
      chartAccountId: accountsPayable.chartAccountId,
      amountCents: accountsPayable.amountCents,
      retentionTotalCents: accountsPayable.retentionTotalCents,
      netAmountCents: accountsPayable.netAmountCents,
      issueDate: accountsPayable.issueDate,
      dueDate: accountsPayable.dueDate,
      description: accountsPayable.description,
      docNumber: accountsPayable.docNumber,
      docKey: accountsPayable.docKey,
      noInvoice: accountsPayable.noInvoice,
      status: accountsPayable.status,
      approvalTrace: accountsPayable.approvalTrace,
      paidAt: accountsPayable.paidAt,
      paidAmountCents: accountsPayable.paidAmountCents,
      paymentMethod: accountsPayable.paymentMethod,
      source: accountsPayable.source,
      createdAt: accountsPayable.createdAt,
      supplierName: persons.name,
      supplierDocument: persons.document,
      chartCode: chartOfAccounts.code,
      chartName: chartOfAccounts.name,
    })
    .from(accountsPayable)
    .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
    .leftJoin(persons, eq(persons.id, suppliers.personId))
    .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsPayable.chartAccountId))
    .where(and(eq(accountsPayable.id, id), eq(accountsPayable.tenantId, tenantId)))
    .limit(1)

  if (!ap) notFound()

  const payments = await db
    .select({
      id: apArPayments.id,
      amountCents: apArPayments.amountCents,
      paidAt: apArPayments.paidAt,
      method: apArPayments.method,
      reference: apArPayments.reference,
      notes: apArPayments.notes,
    })
    .from(apArPayments)
    .where(and(eq(apArPayments.sourceType, 'ap'), eq(apArPayments.sourceId, id)))
    .orderBy(desc(apArPayments.paidAt))

  const trace = Array.isArray(ap.approvalTrace) ? (ap.approvalTrace as TraceEntry[]) : []
  const badge = STATUS_BADGE[ap.status]!
  const paidTotal = payments.reduce((s, p) => s + p.amountCents, 0)
  const remaining = ap.netAmountCents - paidTotal

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>AP {ap.docNumber ?? ap.id.slice(0, 8)}</h1>
        <span
          className="ev-badge"
          style={{ backgroundColor: badge.bg, color: badge.fg, fontSize: 'var(--ev-font-sm)' }}
        >
          {badge.label}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/contas-pagar" className="ev-btn ev-btn-ghost">
          ← Contas a pagar
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
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Valor bruto</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(ap.amountCents)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Líquido</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(ap.netAmountCents)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Pago</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{formatBrl(paidTotal)}</div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>A pagar</div>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--ev-space-lg)',
          alignItems: 'start',
        }}
      >
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h3 style={{ marginTop: 0 }}>Dados</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, margin: 0 }}>
            <dt style={{ color: 'var(--ev-muted)' }}>Fornecedor</dt>
            <dd style={{ margin: 0 }}>
              {ap.supplierId ? (
                <Link href={`/app/financeiro/fornecedores/${ap.supplierId}`}>
                  {ap.supplierName}
                </Link>
              ) : (
                <em>sem fornecedor</em>
              )}
            </dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Conta</dt>
            <dd style={{ margin: 0 }}>
              <code style={{ fontSize: 'var(--ev-font-xs)' }}>{ap.chartCode}</code>{' '}
              {ap.chartName}
            </dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Emissão</dt>
            <dd style={{ margin: 0 }}>{ap.issueDate}</dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Vencimento</dt>
            <dd style={{ margin: 0 }}>{ap.dueDate}</dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Doc Nº</dt>
            <dd style={{ margin: 0 }}>{ap.docNumber ?? '—'}</dd>
            {ap.docKey && (
              <>
                <dt style={{ color: 'var(--ev-muted)' }}>Chave NF-e</dt>
                <dd style={{ margin: 0, fontSize: 'var(--ev-font-xs)' }}>
                  <code>{ap.docKey}</code>
                </dd>
              </>
            )}
            <dt style={{ color: 'var(--ev-muted)' }}>Origem</dt>
            <dd style={{ margin: 0 }}>{ap.source}</dd>
            {ap.noInvoice && (
              <>
                <dt style={{ color: 'var(--ev-muted)' }}>Sem NF</dt>
                <dd style={{ margin: 0 }}>✓ Lançamento sem nota fiscal</dd>
              </>
            )}
          </dl>
          {ap.description && (
            <p style={{ marginTop: 'var(--ev-space-md)', whiteSpace: 'pre-wrap' }}>
              {ap.description}
            </p>
          )}
        </section>

        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h3 style={{ marginTop: 0 }}>Histórico de aprovação</h3>
          {trace.length === 0 ? (
            <p style={{ color: 'var(--ev-muted)', margin: 0 }}>
              AP ainda em rascunho. Submeta à aprovação para iniciar workflow.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--ev-space-sm)',
              }}
            >
              {trace.map((t, i) => (
                <li
                  key={i}
                  style={{
                    borderLeft: `3px solid ${
                      t.action === 'approved'
                        ? 'var(--ev-success, #16a34a)'
                        : t.action === 'rejected'
                          ? 'var(--ev-danger, #dc2626)'
                          : 'var(--ev-info, #1e40af)'
                    }`,
                    paddingLeft: 'var(--ev-space-sm)',
                  }}
                >
                  <div style={{ fontSize: 'var(--ev-font-sm)' }}>
                    <strong>{t.action}</strong>
                    {t.byRole && ` · ${t.byRole}`}
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    {new Date(t.at).toLocaleString('pt-BR')} · user {t.byUserId.slice(0, 8)}
                  </div>
                  {t.comment && (
                    <div style={{ fontSize: 'var(--ev-font-sm)', marginTop: 4 }}>{t.comment}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <APActions apId={ap.id} status={ap.status} />

      {payments.length > 0 && (
        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <header
            style={{
              padding: 'var(--ev-space-md)',
              borderBottom: '1px solid var(--ev-border)',
            }}
          >
            <h3 style={{ margin: 0 }}>Pagamentos registrados</h3>
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
              {payments.map((p) => (
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
