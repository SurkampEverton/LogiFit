import { db } from '@repo/db/client'
import { billingGlosas, billingGuides, members, persons } from '@repo/db/schema'
/**
 * `/app/fisio/glosas` — lista global de glosas (Sprint 22 Faixa C).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  glossed: { label: '⚠ Glosada', bg: 'var(--ev-danger-soft, #fee2e2)' },
  recurring: { label: '📤 Em recurso', bg: 'var(--ev-warning-soft, #fef9c3)' },
  recovered: { label: '✓ Recuperada', bg: 'var(--ev-success-soft, #dcfce7)' },
  lost: { label: '✗ Perdida', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

function formatBrl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function GlosasPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireFullSession('/app/fisio/glosas')
  const tenantId = session.logifit.tenantId
  const params = await searchParams
  const status = params.status ?? 'all'

  const where = [eq(billingGlosas.tenantId, tenantId)]
  if (status !== 'all') where.push(eq(billingGlosas.status, status as 'glossed'))

  const rows = await db
    .select({
      id: billingGlosas.id,
      guideId: billingGlosas.guideId,
      guideNumber: billingGuides.guideNumber,
      reasonCode: billingGlosas.reasonCode,
      reasonDescription: billingGlosas.reasonDescription,
      amountGlossedCents: billingGlosas.amountGlossedCents,
      status: billingGlosas.status,
      receivedAt: billingGlosas.receivedAt,
      recursoAt: billingGlosas.recursoAt,
      resolvedAt: billingGlosas.resolvedAt,
      memberName: persons.name,
    })
    .from(billingGlosas)
    .leftJoin(billingGuides, eq(billingGuides.id, billingGlosas.guideId))
    .leftJoin(members, eq(members.id, billingGuides.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(...where))
    .orderBy(desc(billingGlosas.receivedAt))
    .limit(200)

  // KPIs
  const [agg] = (
    await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(amount_glossed_cents), 0)::bigint AS total_glossed,
        COALESCE(SUM(amount_glossed_cents) FILTER (WHERE status = 'recovered'), 0)::bigint AS total_recovered,
        COUNT(*) FILTER (WHERE status = 'glossed')::int AS open_count
      FROM billing_glosas
      WHERE tenant_id = ${tenantId}
    `)
  ).rows as Array<{
    total_count: number
    total_glossed: number
    total_recovered: number
    open_count: number
  }>
  const k = agg ?? { total_count: 0, total_glossed: 0, total_recovered: 0, open_count: 0 }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Glosas TISS</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/fisio/faturamento" className="ev-btn ev-btn-ghost">
          ← Faturamento
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Total</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{k.total_count}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Valor glosado
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-danger, #b91c1c)',
            }}
          >
            {formatBrl(Number(k.total_glossed))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Recuperado</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(Number(k.total_recovered))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Em aberto</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{k.open_count}</div>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 8 }}>
        {['all', 'glossed', 'recurring', 'recovered', 'lost'].map((s) => (
          <Link
            key={s}
            href={`/app/fisio/glosas${s === 'all' ? '' : `?status=${s}`}`}
            className="ev-btn ev-btn-ghost"
            style={{ borderColor: status === s ? 'var(--ev-primary)' : 'var(--ev-border)' }}
          >
            {s === 'all' ? 'Todas' : s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma glosa no filtro.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Guia</th>
              <th>Paciente</th>
              <th>Código</th>
              <th>Motivo</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Recebida</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const sb = STATUS_BADGE[g.status] ?? { label: g.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={g.id}>
                  <td>
                    <Link href={`/app/fisio/faturamento/${g.guideId}`}>
                      <code>{g.guideNumber ?? '—'}</code>
                    </Link>
                  </td>
                  <td>{g.memberName ?? '—'}</td>
                  <td>
                    <code>{g.reasonCode}</code>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{g.reasonDescription}</td>
                  <td>{formatBrl(g.amountGlossedCents)}</td>
                  <td>
                    <span className="ev-badge" style={{ background: sb.bg }}>
                      {sb.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(g.receivedAt).toLocaleString('pt-BR')}
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
