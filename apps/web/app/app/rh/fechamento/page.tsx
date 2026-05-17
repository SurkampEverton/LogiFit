/**
 * `/app/rh/fechamento` — periods de fechamento (Sprint 23 Faixa C).
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { commissionPeriods, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  draft: { label: '📝 Draft', bg: 'var(--ev-surface)' },
  approved: { label: '✓ Aprovado', bg: 'var(--ev-info-soft, #eff6ff)' },
  paid: { label: '💸 Pago', bg: 'var(--ev-success-soft, #dcfce7)' },
  cancelled: { label: '⊘ Cancelado', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

function formatBrl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function FechamentoPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireFullSession('/app/rh/fechamento')
  const tenantId = session.logifit.tenantId
  const params = await searchParams
  const status = params.status ?? 'all'

  const where = [eq(commissionPeriods.tenantId, tenantId)]
  if (status !== 'all')
    where.push(eq(commissionPeriods.status, status as 'draft'))

  const rows = await db
    .select({
      id: commissionPeriods.id,
      personId: commissionPeriods.personId,
      personName: persons.name,
      periodStart: commissionPeriods.periodStart,
      periodEnd: commissionPeriods.periodEnd,
      totalEntries: commissionPeriods.totalEntries,
      grossTotalCents: commissionPeriods.grossTotalCents,
      retentionTotalCents: commissionPeriods.retentionTotalCents,
      netTotalCents: commissionPeriods.netTotalCents,
      status: commissionPeriods.status,
      approvedAt: commissionPeriods.approvedAt,
      paidAt: commissionPeriods.paidAt,
    })
    .from(commissionPeriods)
    .leftJoin(persons, eq(persons.id, commissionPeriods.personId))
    .where(and(...where))
    .orderBy(desc(commissionPeriods.periodStart))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Fechamento mensal</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} periods</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/rh" className="ev-btn ev-btn-ghost">
          ← RH
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Pipeline <strong>draft → approved → paid</strong>. closePeriod agrega
          entries pendentes do mês; approvePeriod faz transição (requer permission
          rh.approve); markPeriodPaid grava `asaas_transfer_id` quando Sprint 23b
          integrar transferência real Asaas.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {['all', 'draft', 'approved', 'paid'].map((s) => (
          <Link
            key={s}
            href={`/app/rh/fechamento${s === 'all' ? '' : `?status=${s}`}`}
            className="ev-btn ev-btn-ghost"
            style={{ borderColor: status === s ? 'var(--ev-primary)' : 'var(--ev-border)' }}
          >
            {s === 'all' ? 'Todos' : s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhum period no filtro.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Período</th>
              <th>Entries</th>
              <th>Bruto</th>
              <th>Retenção</th>
              <th>Líquido</th>
              <th>Status</th>
              <th>Aprovado em</th>
              <th>Pago em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const sb = STATUS_BADGE[p.status] ?? { label: p.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={p.id}>
                  <td>{p.personName ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {p.periodStart} → {p.periodEnd}
                  </td>
                  <td>{p.totalEntries}</td>
                  <td>{formatBrl(p.grossTotalCents)}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger, #b91c1c)' }}>
                    {p.retentionTotalCents > 0 ? `− ${formatBrl(p.retentionTotalCents)}` : '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatBrl(p.netTotalCents)}</td>
                  <td>
                    <span className="ev-badge" style={{ background: sb.bg }}>
                      {sb.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {p.approvedAt ? new Date(p.approvedAt).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {p.paidAt ? new Date(p.paidAt).toLocaleDateString('pt-BR') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
