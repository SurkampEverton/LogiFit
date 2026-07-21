import { db } from '@repo/db/client'
import { accountsPayable, persons, suppliers } from '@repo/db/schema'
/**
 * `/app/financeiro/fornecedores/[id]` — detalhe do fornecedor + histórico AP.
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const AP_STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
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
  cancelled: {
    bg: 'var(--ev-muted-bg, #e5e7eb)',
    fg: 'var(--ev-muted, #6b7280)',
    label: 'Cancelada',
  },
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

function formatDoc(doc: string | null, kind: string): string {
  if (!doc) return '—'
  if (kind === 'pf' && doc.length === 11) {
    return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9, 11)}`
  }
  if (kind === 'pj' && doc.length === 14) {
    return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12, 14)}`
  }
  return doc
}

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/fornecedores/${id}`)
  const tenantId = session.logifit.tenantId

  const [supplier] = await db
    .select({
      id: suppliers.id,
      personId: suppliers.personId,
      defaultPaymentMethod: suppliers.defaultPaymentMethod,
      defaultPaymentTermDays: suppliers.defaultPaymentTermDays,
      bankAccount: suppliers.bankAccount,
      notes: suppliers.notes,
      archivedAt: suppliers.archivedAt,
      createdAt: suppliers.createdAt,
      personName: persons.name,
      personDocument: persons.document,
      personKind: persons.kind,
      personEmail: persons.email,
      personPhone: persons.phone,
    })
    .from(suppliers)
    .leftJoin(persons, eq(persons.id, suppliers.personId))
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)))
    .limit(1)

  if (!supplier) notFound()

  const apHistory = await db
    .select({
      id: accountsPayable.id,
      amountCents: accountsPayable.amountCents,
      netAmountCents: accountsPayable.netAmountCents,
      dueDate: accountsPayable.dueDate,
      status: accountsPayable.status,
      description: accountsPayable.description,
      paidAt: accountsPayable.paidAt,
    })
    .from(accountsPayable)
    .where(and(eq(accountsPayable.supplierId, id), eq(accountsPayable.tenantId, tenantId)))
    .orderBy(desc(accountsPayable.dueDate))
    .limit(30)

  const bank = (supplier.bankAccount as Record<string, string> | null) ?? null

  const totalPago = apHistory
    .filter((ap) => ap.status === 'paid' || ap.status === 'reconciled')
    .reduce((s, ap) => s + ap.netAmountCents, 0)
  const totalAberto = apHistory
    .filter((ap) => ['pending_approval', 'approved', 'scheduled'].includes(ap.status))
    .reduce((s, ap) => s + ap.netAmountCents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>{supplier.personName}</h1>
        <span className="ev-badge">{supplier.personKind?.toUpperCase()}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/fornecedores" className="ev-btn ev-btn-ghost">
          ← Fornecedores
        </Link>
        <Link href={`/app/pessoas/${supplier.personId}`} className="ev-btn ev-btn-ghost">
          Editar identidade
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
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Total pago</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalPago)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Em aberto</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalAberto)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Notas fiscais
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{apHistory.length}</div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2fr',
          gap: 'var(--ev-space-lg)',
          alignItems: 'start',
        }}
      >
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h3 style={{ marginTop: 0 }}>Dados</h3>
          <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, margin: 0 }}>
            <dt style={{ color: 'var(--ev-muted)' }}>Documento</dt>
            <dd style={{ margin: 0 }}>
              <code>{formatDoc(supplier.personDocument, supplier.personKind ?? 'pj')}</code>
            </dd>
            <dt style={{ color: 'var(--ev-muted)' }}>E-mail</dt>
            <dd style={{ margin: 0 }}>{supplier.personEmail ?? '—'}</dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Telefone</dt>
            <dd style={{ margin: 0 }}>{supplier.personPhone ?? '—'}</dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Pgto padrão</dt>
            <dd style={{ margin: 0 }}>{supplier.defaultPaymentMethod?.toUpperCase() ?? '—'}</dd>
            <dt style={{ color: 'var(--ev-muted)' }}>Prazo</dt>
            <dd style={{ margin: 0 }}>
              {supplier.defaultPaymentTermDays != null
                ? `D+${supplier.defaultPaymentTermDays}`
                : '—'}
            </dd>
            {bank?.pixKey && (
              <>
                <dt style={{ color: 'var(--ev-muted)' }}>PIX</dt>
                <dd style={{ margin: 0 }}>
                  <code>{bank.pixKey}</code>
                </dd>
              </>
            )}
            {(bank?.bank || bank?.agency || bank?.account) && (
              <>
                <dt style={{ color: 'var(--ev-muted)' }}>Banco</dt>
                <dd style={{ margin: 0 }}>
                  {bank.bank} {bank.agency} {bank.account}
                </dd>
              </>
            )}
          </dl>
          {supplier.notes && (
            <p style={{ marginTop: 'var(--ev-space-md)', whiteSpace: 'pre-wrap' }}>
              {supplier.notes}
            </p>
          )}
        </section>

        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <header
            style={{
              padding: 'var(--ev-space-md)',
              borderBottom: '1px solid var(--ev-border)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--ev-space-md)',
            }}
          >
            <h3 style={{ margin: 0 }}>Histórico de contas a pagar</h3>
            <span style={{ color: 'var(--ev-muted)', fontSize: 'var(--ev-font-sm)' }}>
              {apHistory.length} lançamentos
            </span>
          </header>
          {apHistory.length === 0 ? (
            <p style={{ padding: 'var(--ev-space-md)', margin: 0, color: 'var(--ev-muted)' }}>
              Nenhuma AP lançada para este fornecedor ainda.
            </p>
          ) : (
            <table className="ev-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Vencimento</th>
                  <th style={{ textAlign: 'left' }}>Descrição</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th style={{ textAlign: 'right' }}>Valor líquido</th>
                </tr>
              </thead>
              <tbody>
                {apHistory.map((ap) => {
                  const badge = AP_STATUS_BADGE[ap.status]!
                  return (
                    <tr key={ap.id}>
                      <td>{ap.dueDate}</td>
                      <td>
                        <Link href={`/app/financeiro/contas-pagar/${ap.id}`}>
                          {ap.description ?? '—'}
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
                      <td style={{ textAlign: 'right' }}>{formatBrl(ap.netAmountCents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
