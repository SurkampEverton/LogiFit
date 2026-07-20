import { db } from '@repo/db/client'
/**
 * `/app/nutri-agent` — dashboard de sugestões pendentes do Nutri-Agent IA.
 *   Sprint 34 Faixa C.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  plan_adjustment: '🍽 Ajuste de plano',
  alert: '⚠ Alerta',
  risk_pattern: '🩺 Padrão de risco',
  pre_consult_summary: '📋 Resumo pré-consulta',
  follow_up_exam: '🧪 Exame complementar',
}

const SEVERITY_COLOR: Record<string, string> = {
  info: 'var(--ev-text-muted)',
  attention: 'var(--ev-warning)',
  critical: 'var(--ev-danger)',
}

interface PageProps {
  searchParams: Promise<{ severity?: string }>
}

export default async function NutriAgentDashboardPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/nutri-agent')
  const tenantId = session.logifit.tenantId
  const { severity } = await searchParams

  // KPIs
  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM nutri_agent_suggestions WHERE tenant_id = ${tenantId} AND status = 'pending') AS pending,
        (SELECT COUNT(*)::int FROM nutri_agent_suggestions WHERE tenant_id = ${tenantId} AND status = 'pending' AND severity = 'critical') AS critical,
        (SELECT COUNT(*)::int FROM nutri_agent_suggestions WHERE tenant_id = ${tenantId} AND status = 'accepted' AND reviewed_at > NOW() - INTERVAL '30 days') AS accepted_30d,
        (SELECT COUNT(*)::int FROM nutri_agent_runs WHERE tenant_id = ${tenantId} AND status = 'completed' AND completed_at > NOW() - INTERVAL '30 days') AS runs_30d,
        (SELECT COUNT(*)::int FROM nutri_agent_runs WHERE tenant_id = ${tenantId} AND status = 'blocked' AND queued_at > NOW() - INTERVAL '30 days') AS blocked_30d
    `)
  ).rows as Array<{
    pending: number
    critical: number
    accepted_30d: number
    runs_30d: number
    blocked_30d: number
  }>

  const kpi = k ?? { pending: 0, critical: 0, accepted_30d: 0, runs_30d: 0, blocked_30d: 0 }

  const rows = (
    await db.execute(sql`
      SELECT
        nas.id,
        nas.member_id,
        p.name AS member_name,
        nas.kind::text AS kind,
        nas.severity::text AS severity,
        nas.title,
        nas.description,
        nas.confidence,
        nas.blocked_by_classifier,
        nas.created_at,
        nas.expires_at
      FROM nutri_agent_suggestions nas
      INNER JOIN members m ON m.id = nas.member_id
      INNER JOIN persons p ON p.id = m.person_id
      WHERE nas.tenant_id = ${tenantId}
        AND nas.status = 'pending'
        ${severity ? sql`AND nas.severity::text = ${severity}` : sql``}
      ORDER BY
        CASE nas.severity
          WHEN 'critical' THEN 1
          WHEN 'attention' THEN 2
          ELSE 3
        END,
        nas.created_at DESC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    member_id: string
    member_name: string
    kind: string
    severity: string
    title: string
    description: string
    confidence: string
    blocked_by_classifier: boolean
    created_at: string
    expires_at: string
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Nutri-Agent IA</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Sprint 34 · ADRs 0043+0044 · SaMD Classe II
        </span>
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
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Pendentes
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.pending}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Críticas
          </div>
          <div
            style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600, color: 'var(--ev-danger)' }}
          >
            {kpi.critical}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Aceitas 30d
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.accepted_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Runs 30d
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.runs_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Bloqueadas Comitê IA 30d
          </div>
          <div
            style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600, color: 'var(--ev-warning)' }}
          >
            {kpi.blocked_30d}
          </div>
        </div>
      </section>

      <nav style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
        <Link
          href="/app/nutri-agent"
          className="ev-btn ev-btn-ghost"
          style={{ fontWeight: !severity ? 600 : 400 }}
        >
          Todas
        </Link>
        {['critical', 'attention', 'info'].map((s) => (
          <Link
            key={s}
            href={`/app/nutri-agent?severity=${s}`}
            className="ev-btn ev-btn-ghost"
            style={{ fontWeight: severity === s ? 600 : 400, color: SEVERITY_COLOR[s] }}
          >
            {s}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Sem sugestões pendentes. Rode o agent para um paciente em{' '}
            <code>/app/members/[id]/nutri-summary</code>.
          </p>
        </section>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-md)' }}>
          {rows.map((r) => (
            <li
              key={r.id}
              className="ev-card"
              style={{
                padding: 'var(--ev-space-md)',
                borderLeft: `4px solid ${SEVERITY_COLOR[r.severity] ?? 'var(--ev-border)'}`,
              }}
            >
              <header
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <div>
                  <strong>{KIND_LABEL[r.kind] ?? r.kind}: </strong>
                  {r.title}
                </div>
                <small style={{ color: 'var(--ev-text-muted)' }}>
                  {(Number(r.confidence) * 100).toFixed(0)}% · expira{' '}
                  {new Date(r.expires_at).toLocaleDateString('pt-BR')}
                </small>
              </header>
              <p style={{ margin: '8px 0', whiteSpace: 'pre-line', fontSize: 'var(--ev-text-sm)' }}>
                {r.description}
              </p>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <small style={{ color: 'var(--ev-text-muted)' }}>
                  Paciente:{' '}
                  <Link href={`/app/members/${r.member_id}/nutri-summary`}>{r.member_name}</Link>
                </small>
                {r.blocked_by_classifier ? (
                  <small style={{ color: 'var(--ev-warning)' }}>⚠ Classifier bloqueou</small>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p style={{ color: 'var(--ev-text-muted)' }}>
        <strong>UI completa (accept/reject inline + diff visual de proposedChanges)</strong> entra
        em Sprint 34b. MVP entrega backend + lista read-only.
      </p>
    </div>
  )
}
