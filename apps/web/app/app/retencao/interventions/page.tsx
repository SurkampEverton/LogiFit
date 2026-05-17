/**
 * `/app/retencao/interventions` — lista global de intervenções (Sprint 19 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const ACTION_LABEL: Record<string, string> = {
  phone_call: '📞 Ligação',
  whatsapp_message: '💬 WhatsApp',
  free_pass: '🎫 Passe livre',
  discount_offer: '💸 Desconto',
  in_person_visit: '🚶 Visita',
  manual: '✍️ Manual',
}

const OUTCOME_LABEL: Record<string, { label: string; bg: string }> = {
  success: { label: '✓ Sucesso', bg: 'var(--ev-success-soft, #dcfce7)' },
  partial: { label: '~ Parcial', bg: 'var(--ev-warning-soft, #fef9c3)' },
  failed: { label: '✗ Falhou', bg: 'var(--ev-danger-soft, #fee2e2)' },
  member_canceled_anyway: { label: '⚠ Cancelou', bg: 'var(--ev-danger-soft, #fee2e2)' },
}

export default async function InterventionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await requireFullSession('/app/retencao/interventions')
  const tenantId = session.logifit.tenantId
  const params = await searchParams
  const status = params.status ?? 'open' // open / closed / all

  const interventions = (
    await db.execute(sql`
      SELECT
        ci.id,
        ci.action,
        ci.notes,
        ci.assigned_at,
        ci.closed_at,
        ci.outcome,
        ci.outcome_notes,
        ci.member_id,
        m_p.name AS member_name,
        u_assigned.username AS assigned_to_email,
        cp.prob_30d,
        cp.risk_band
      FROM churn_interventions ci
      INNER JOIN members m ON m.id = ci.member_id
      INNER JOIN persons m_p ON m_p.id = m.person_id
      LEFT JOIN users u_assigned ON u_assigned.id = ci.assigned_to_user_id
      LEFT JOIN churn_predictions cp ON cp.id = ci.prediction_id
      WHERE ci.tenant_id = ${tenantId}
        ${
          status === 'open'
            ? sql`AND ci.closed_at IS NULL`
            : status === 'closed'
              ? sql`AND ci.closed_at IS NOT NULL`
              : sql``
        }
      ORDER BY ci.assigned_at DESC
      LIMIT 200
    `)
  ).rows as Array<{
    id: string
    action: string
    notes: string | null
    assigned_at: string
    closed_at: string | null
    outcome: string | null
    outcome_notes: string | null
    member_id: string
    member_name: string
    assigned_to_email: string | null
    prob_30d: string | null
    risk_band: string | null
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Intervenções</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{interventions.length} resultado(s)</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <Link
            href="/app/retencao/interventions?status=open"
            className="ev-btn ev-btn-ghost"
            style={{
              borderColor:
                status === 'open' ? 'var(--ev-primary)' : 'var(--ev-border)',
            }}
          >
            Abertas
          </Link>
          <Link
            href="/app/retencao/interventions?status=closed"
            className="ev-btn ev-btn-ghost"
            style={{
              borderColor:
                status === 'closed' ? 'var(--ev-primary)' : 'var(--ev-border)',
            }}
          >
            Encerradas
          </Link>
          <Link
            href="/app/retencao/interventions?status=all"
            className="ev-btn ev-btn-ghost"
            style={{ borderColor: status === 'all' ? 'var(--ev-primary)' : 'var(--ev-border)' }}
          >
            Todas
          </Link>
        </div>
        <Link href="/app/retencao" className="ev-btn ev-btn-ghost">
          ← Retenção
        </Link>
      </header>

      {interventions.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma intervenção no filtro.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Member</th>
              <th>P(30d)</th>
              <th>Ação</th>
              <th>Atendente</th>
              <th>Atribuída</th>
              <th>Outcome</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {interventions.map((i) => {
              const outcome = i.outcome ? OUTCOME_LABEL[i.outcome] : null
              return (
                <tr key={i.id}>
                  <td>
                    <Link href={`/app/retencao/member/${i.member_id}`}>
                      {i.member_name}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {i.prob_30d != null ? `${Math.round(Number(i.prob_30d) * 100)}%` : '—'}
                  </td>
                  <td>{ACTION_LABEL[i.action] ?? i.action}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{i.assigned_to_email ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(i.assigned_at).toLocaleString('pt-BR')}
                  </td>
                  <td>
                    {outcome ? (
                      <span className="ev-badge" style={{ background: outcome.bg }}>
                        {outcome.label}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ev-muted)' }}>aberta</span>
                    )}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {i.notes ?? ''}
                    {i.outcome_notes && (
                      <div style={{ color: 'var(--ev-muted)' }}>→ {i.outcome_notes}</div>
                    )}
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
