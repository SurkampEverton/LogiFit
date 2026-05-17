/**
 * `/app/retencao` — home gestor de retenção (Sprint 19 Faixa C).
 *
 * Top N members em risco + KPIs agregados + link pra detalhe e intervenções.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const BAND_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  low: { label: 'Baixo', bg: 'var(--ev-success-soft, #dcfce7)', color: 'var(--ev-success, #16a34a)' },
  medium: { label: 'Médio', bg: 'var(--ev-warning-soft, #fef9c3)', color: 'var(--ev-warning, #ca8a04)' },
  high: { label: 'Alto', bg: 'var(--ev-danger-soft, #fee2e2)', color: 'var(--ev-danger, #b91c1c)' },
}

export default async function RetencaoHomePage() {
  const session = await requireFullSession('/app/retencao')
  const tenantId = session.logifit.tenantId

  // KPIs
  const [stats] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(DISTINCT member_id) FROM churn_predictions WHERE tenant_id = ${tenantId})::int AS members_scored,
        (SELECT COUNT(*) FROM churn_predictions cp1 WHERE cp1.tenant_id = ${tenantId} AND cp1.risk_band = 'high'
          AND cp1.predicted_at = (SELECT MAX(cp2.predicted_at) FROM churn_predictions cp2 WHERE cp2.member_id = cp1.member_id))::int AS high_now,
        (SELECT COUNT(*) FROM churn_predictions cp1 WHERE cp1.tenant_id = ${tenantId} AND cp1.risk_band = 'medium'
          AND cp1.predicted_at = (SELECT MAX(cp2.predicted_at) FROM churn_predictions cp2 WHERE cp2.member_id = cp1.member_id))::int AS medium_now,
        (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND closed_at IS NULL)::int AS open_intv,
        (SELECT COUNT(*) FROM churn_events WHERE tenant_id = ${tenantId} AND event_at > NOW() - INTERVAL '30 days')::int AS cancellations_30d
    `)
  ).rows as Array<{
    members_scored: number
    high_now: number
    medium_now: number
    open_intv: number
    cancellations_30d: number
  }>

  // Top em risco
  const atRisk = (
    await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (member_id)
          id, member_id, prob_30d, prob_60d, prob_90d, risk_band, top_factors, predicted_at, source
        FROM churn_predictions
        WHERE tenant_id = ${tenantId}
        ORDER BY member_id, predicted_at DESC
      )
      SELECT
        m.id AS member_id,
        p.name AS member_name,
        latest.id AS prediction_id,
        latest.prob_30d,
        latest.prob_60d,
        latest.prob_90d,
        latest.risk_band,
        latest.predicted_at,
        latest.source,
        (SELECT COUNT(*) FROM churn_interventions ci WHERE ci.member_id = m.id AND ci.closed_at IS NULL)::int AS open_interventions
      FROM members m
      INNER JOIN persons p ON p.id = m.person_id
      INNER JOIN latest ON latest.member_id = m.id
      WHERE m.tenant_id = ${tenantId} AND m.archived_at IS NULL
      ORDER BY latest.prob_30d DESC
      LIMIT 30
    `)
  ).rows as Array<{
    member_id: string
    member_name: string
    prediction_id: string
    prob_30d: string
    prob_60d: string
    prob_90d: string
    risk_band: 'low' | 'medium' | 'high'
    predicted_at: string
    source: string
    open_interventions: number
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Retenção</h1>
        <span style={{ color: 'var(--ev-muted)' }}>previsão de churn — ADR 0027 Fase 1</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/retencao/interventions" className="ev-btn ev-btn-ghost">
          🎯 Intervenções
        </Link>
        <Link href="/app/retencao/model" className="ev-btn ev-btn-ghost">
          📊 Modelo
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
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Members scored
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {stats?.members_scored ?? 0}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Risco alto agora
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-danger, #b91c1c)',
            }}
          >
            {stats?.high_now ?? 0}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Risco médio agora
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-warning, #ca8a04)',
            }}
          >
            {stats?.medium_now ?? 0}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Intervenções abertas
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {stats?.open_intv ?? 0}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Cancelamentos 30d
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {stats?.cancellations_30d ?? 0}
          </div>
        </div>
      </section>

      <h2>Members em maior risco</h2>
      {atRisk.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma predição computada ainda. Use a Server Action <code>scorePredict</code>
            no detalhe de um member ou rode <code>db:seed:retencao</code> para popular o
            ambiente de demo.
          </p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Member</th>
              <th>Risco</th>
              <th style={{ textAlign: 'right' }}>P(30d)</th>
              <th style={{ textAlign: 'right' }}>P(60d)</th>
              <th style={{ textAlign: 'right' }}>P(90d)</th>
              <th>Fonte</th>
              <th>Intervenção?</th>
              <th>Última predição</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {atRisk.map((m) => {
              const badge = BAND_LABEL[m.risk_band] ?? BAND_LABEL.low
              return (
                <tr key={m.member_id}>
                  <td>
                    <Link href={`/app/retencao/member/${m.member_id}`}>{m.member_name}</Link>
                  </td>
                  <td>
                    <span
                      className="ev-badge"
                      style={{ background: badge!.bg, color: badge!.color }}
                    >
                      {badge!.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {Math.round(Number(m.prob_30d) * 100)}%
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {Math.round(Number(m.prob_60d) * 100)}%
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {Math.round(Number(m.prob_90d) * 100)}%
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{m.source}</td>
                  <td>
                    {m.open_interventions > 0 ? (
                      <span className="ev-badge">🎯 {m.open_interventions}</span>
                    ) : (
                      <span style={{ color: 'var(--ev-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(m.predicted_at).toLocaleString('pt-BR')}
                  </td>
                  <td>
                    <Link
                      href={`/app/retencao/member/${m.member_id}`}
                      className="ev-btn ev-btn-ghost"
                    >
                      Detalhe →
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
