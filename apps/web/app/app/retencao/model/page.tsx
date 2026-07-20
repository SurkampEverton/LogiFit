import { db } from '@repo/db/client'
/**
 * `/app/retencao/model` — metadados do modelo + accuracy (Sprint 19 Faixa C).
 *
 * Estatísticas agregadas: members scored, recall estimate, intervention success rate.
 * No MVP só recall é calculado (não temos cohort de FP confiável ainda).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ModelPage() {
  const session = await requireFullSession('/app/retencao/model')
  const tenantId = session.logifit.tenantId

  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(DISTINCT member_id) FROM churn_predictions WHERE tenant_id = ${tenantId})::int AS members_scored,
      (SELECT COUNT(*) FROM churn_predictions WHERE tenant_id = ${tenantId})::int AS total_predictions,
      (SELECT COUNT(*) FROM churn_events WHERE tenant_id = ${tenantId})::int AS total_cancellations,
      (SELECT COUNT(*) FROM churn_events WHERE tenant_id = ${tenantId} AND was_predicted = true)::int AS predicted_cancellations,
      (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND closed_at IS NULL)::int AS open_intv,
      (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND outcome = 'success')::int AS success_intv,
      (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND closed_at IS NOT NULL)::int AS closed_intv,
      (SELECT AVG(latency_ms)::int FROM churn_predictions WHERE tenant_id = ${tenantId})::int AS avg_latency_ms
  `)
  const row = (result.rows[0] ?? {}) as Record<string, number | null>

  const totalCancellations = Number(row.total_cancellations ?? 0)
  const predictedCancellations = Number(row.predicted_cancellations ?? 0)
  const recall = totalCancellations === 0 ? null : predictedCancellations / totalCancellations
  const closedIntv = Number(row.closed_intv ?? 0)
  const successIntv = Number(row.success_intv ?? 0)
  const successRate = closedIntv === 0 ? null : successIntv / closedIntv

  const versionsResult = await db.execute(sql`
    SELECT
      model_version,
      source,
      COUNT(*) AS predictions,
      AVG(latency_ms) AS avg_latency_ms
    FROM churn_predictions
    WHERE tenant_id = ${tenantId}
    GROUP BY model_version, source
    ORDER BY predictions DESC
  `)
  const versions = versionsResult.rows as Array<{
    model_version: string
    source: string
    predictions: number
    avg_latency_ms: number | null
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Modelo de churn</h1>
        <span style={{ color: 'var(--ev-muted)' }}>ADR 0027 — Fase 1 (heurística + LLM)</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/retencao" className="ev-btn ev-btn-ghost">
          ← Retenção
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0 }}>
          O LogiFit roda predição de churn em <strong>2 fases</strong> conforme{' '}
          <Link href="https://github.com/SurkampEverton/LogiFit/blob/main/docs/decisions/0027-estrategia-modelo-churn.md">
            ADR 0027
          </Link>
          . Atualmente Fase 1: heurística determinística (40% absence + 30% frequency drop + 20%
          overdue + 10% downgrade) com atenuadores de engajamento (achievements + goals) e loyalty
          buff. Gemini Flash via <code>resolveModelForTask('classification')</code> entra como
          upgrade quando habilitado no env (mantém mesma assinatura — wrapper{' '}
          <code>predictChurn</code> escolhe LLM ou heurística e cai pra heurística se Zod falhar).
        </p>
        <p style={{ marginBottom: 0 }}>
          Fase 2 (sklearn/XGBoost em edge function) entra quando volume &gt;500/dia/tenant OU
          precision &lt;70% OU latência P95 &gt;500ms. Wrapper preserva interface.
        </p>
      </div>

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
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Members scored
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {row.members_scored ?? 0}
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            {row.total_predictions ?? 0} predições total
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Recall estimado
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {recall != null ? `${Math.round(recall * 100)}%` : '—'}
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            {predictedCancellations}/{totalCancellations} cancelamentos previstos
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Intervenções: sucesso
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {successRate != null ? `${Math.round(successRate * 100)}%` : '—'}
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            {successIntv}/{closedIntv} encerradas com sucesso
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Latência média
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {row.avg_latency_ms ?? 0} ms
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Heurística &lt;10ms; LLM 2-5s
          </div>
        </div>
      </section>

      <h2>Versões em uso</h2>
      {versions.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>—</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Model version</th>
              <th>Fonte</th>
              <th style={{ textAlign: 'right' }}>Predições</th>
              <th style={{ textAlign: 'right' }}>Latência média</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.model_version + v.source}>
                <td>
                  <code>{v.model_version}</code>
                </td>
                <td>{v.source}</td>
                <td style={{ textAlign: 'right' }}>{v.predictions}</td>
                <td style={{ textAlign: 'right' }}>
                  {v.avg_latency_ms != null ? `${Math.round(Number(v.avg_latency_ms))} ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
