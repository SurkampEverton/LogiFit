/**
 * `/app/fisio/faturamento` — lista de guias TISS (Sprint 22 Faixa C).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { billingGuides, members, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  draft: { label: 'Rascunho', bg: 'var(--ev-surface)' },
  ready: { label: '🟢 Pronta', bg: 'var(--ev-info-soft, #eff6ff)' },
  sent: { label: '📤 Enviada', bg: 'var(--ev-warning-soft, #fef9c3)' },
  paid: { label: '✓ Paga', bg: 'var(--ev-success-soft, #dcfce7)' },
  partially_paid: { label: '~ Paga parcial', bg: 'var(--ev-warning-soft, #fef9c3)' },
  fully_glossed: { label: '⚠ Glosa total', bg: 'var(--ev-danger-soft, #fee2e2)' },
  cancelled: { label: '⊘ Cancelada', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

function formatBrl(cents: number | null): string {
  if (cents == null) return '—'
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function FaturamentoPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireFullSession('/app/fisio/faturamento')
  const tenantId = session.logifit.tenantId
  const params = await searchParams
  const status = params.status ?? 'all'

  const where = [eq(billingGuides.tenantId, tenantId)]
  if (status !== 'all') {
    where.push(eq(billingGuides.status, status as 'draft'))
  }

  const guides = await db
    .select({
      id: billingGuides.id,
      guideNumber: billingGuides.guideNumber,
      kind: billingGuides.kind,
      status: billingGuides.status,
      totalCents: billingGuides.totalCents,
      paidAmountCents: billingGuides.paidAmountCents,
      sentAt: billingGuides.sentAt,
      paidAt: billingGuides.paidAt,
      createdAt: billingGuides.createdAt,
      memberName: persons.name,
    })
    .from(billingGuides)
    .leftJoin(members, eq(members.id, billingGuides.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(...where))
    .orderBy(desc(billingGuides.createdAt))
    .limit(200)

  // KPIs agregados
  const [agg] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(total_cents), 0)::bigint AS total_billed,
        COALESCE(SUM(paid_amount_cents), 0)::bigint AS total_paid,
        COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE status = 'fully_glossed')::int AS glossed_count
      FROM billing_guides
      WHERE tenant_id = ${tenantId}
    `)
  ).rows as Array<{
    total_count: number
    total_billed: number
    total_paid: number
    ready_count: number
    sent_count: number
    glossed_count: number
  }>
  const k = agg ?? {
    total_count: 0,
    total_billed: 0,
    total_paid: 0,
    ready_count: 0,
    sent_count: 0,
    glossed_count: 0,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Faturamento TISS</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/fisio/faturamento/lote/new" className="ev-btn ev-btn-primary">
          + Novo lote
        </Link>
        <Link href="/app/fisio/faturamento/retornos" className="ev-btn ev-btn-ghost">
          📥 Retornos
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Total</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{k.total_count}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Faturado</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(Number(k.total_billed))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Recebido</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600, color: 'var(--ev-success, #16a34a)' }}>
            {formatBrl(Number(k.total_paid))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Prontas / Enviadas</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {k.ready_count} / {k.sent_count}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Glosadas</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600, color: 'var(--ev-danger, #b91c1c)' }}>
            {k.glossed_count}
          </div>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 8 }}>
        {['all', 'draft', 'ready', 'sent', 'paid', 'fully_glossed'].map((s) => (
          <Link
            key={s}
            href={`/app/fisio/faturamento${s === 'all' ? '' : `?status=${s}`}`}
            className="ev-btn ev-btn-ghost"
            style={{ borderColor: status === s ? 'var(--ev-primary)' : 'var(--ev-border)' }}
          >
            {s === 'all' ? 'Todas' : s}
          </Link>
        ))}
      </div>

      {guides.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma guia no filtro.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Número</th>
              <th>Tipo</th>
              <th>Paciente</th>
              <th>Total</th>
              <th>Recebido</th>
              <th>Status</th>
              <th>Enviada</th>
              <th>Paga</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {guides.map((g) => {
              const sb = STATUS_BADGE[g.status] ?? { label: g.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={g.id}>
                  <td>
                    <code>{g.guideNumber}</code>
                  </td>
                  <td>{g.kind}</td>
                  <td>{g.memberName ?? '—'}</td>
                  <td>{formatBrl(g.totalCents)}</td>
                  <td>{formatBrl(g.paidAmountCents)}</td>
                  <td>
                    <span className="ev-badge" style={{ background: sb.bg }}>
                      {sb.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {g.sentAt ? new Date(g.sentAt).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {g.paidAt ? new Date(g.paidAt).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td>
                    <Link
                      href={`/app/fisio/faturamento/${g.id}`}
                      className="ev-btn ev-btn-ghost"
                    >
                      →
                    </Link>
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
