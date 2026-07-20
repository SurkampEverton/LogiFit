import { db } from '@repo/db/client'
import { commissionEntries, persons } from '@repo/db/schema'
/**
 * `/app/rh/comissoes` — entries de comissão (Sprint 23 Faixa C).
 */
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  pending: { label: '⏳ Pendente', bg: 'var(--ev-warning-soft, #fef9c3)' },
  included: { label: '📥 Incluída em period', bg: 'var(--ev-info-soft, #eff6ff)' },
  excluded: { label: '⊘ Excluída', bg: 'var(--ev-muted-soft, #f3f4f6)' },
  reversed: { label: '↩ Estornada', bg: 'var(--ev-danger-soft, #fee2e2)' },
}

function formatBrl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ComissoesPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireFullSession('/app/rh/comissoes')
  const tenantId = session.logifit.tenantId
  const params = await searchParams
  const status = params.status ?? 'all'

  const where = [eq(commissionEntries.tenantId, tenantId)]
  if (status !== 'all') where.push(eq(commissionEntries.status, status as 'pending'))

  const rows = await db
    .select({
      id: commissionEntries.id,
      personId: commissionEntries.personId,
      personName: persons.name,
      sourceEventRef: commissionEntries.sourceEventRef,
      referenceAmountCents: commissionEntries.referenceAmountCents,
      commissionCents: commissionEntries.commissionCents,
      retentionTotalCents: commissionEntries.retentionTotalCents,
      netAmountCents: commissionEntries.netAmountCents,
      percentApplied: commissionEntries.percentApplied,
      serviceType: commissionEntries.serviceType,
      status: commissionEntries.status,
      earnedAt: commissionEntries.earnedAt,
    })
    .from(commissionEntries)
    .leftJoin(persons, eq(persons.id, commissionEntries.personId))
    .where(where.length === 1 ? where[0]! : (where as never))
    .orderBy(desc(commissionEntries.earnedAt))
    .limit(200)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Entries de comissão</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} resultados</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/rh" className="ev-btn ev-btn-ghost">
          ← RH
        </Link>
      </header>

      <div style={{ display: 'flex', gap: 8 }}>
        {['all', 'pending', 'included', 'excluded', 'reversed'].map((s) => (
          <Link
            key={s}
            href={`/app/rh/comissoes${s === 'all' ? '' : `?status=${s}`}`}
            className="ev-btn ev-btn-ghost"
            style={{ borderColor: status === s ? 'var(--ev-primary)' : 'var(--ev-border)' }}
          >
            {s === 'all' ? 'Todas' : s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma entry no filtro.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Fonte</th>
              <th>Serviço</th>
              <th>Ref</th>
              <th>%</th>
              <th>Bruto</th>
              <th>Retenção</th>
              <th>Líquido</th>
              <th>Status</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const sb = STATUS_BADGE[e.status] ?? { label: e.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={e.id}>
                  <td>{e.personName ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    <code>{e.sourceEventRef.slice(0, 20)}…</code>
                  </td>
                  <td>{e.serviceType ?? '—'}</td>
                  <td>{formatBrl(e.referenceAmountCents)}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {e.percentApplied != null ? `${Number(e.percentApplied).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatBrl(e.commissionCents)}</td>
                  <td style={{ color: 'var(--ev-danger, #b91c1c)', fontSize: 'var(--ev-font-xs)' }}>
                    {e.retentionTotalCents > 0 ? `− ${formatBrl(e.retentionTotalCents)}` : '—'}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--ev-success, #16a34a)' }}>
                    {formatBrl(e.netAmountCents)}
                  </td>
                  <td>
                    <span className="ev-badge" style={{ background: sb.bg }}>
                      {sb.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(e.earnedAt).toLocaleDateString('pt-BR')}
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
