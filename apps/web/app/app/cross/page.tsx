import { db } from '@repo/db/client'
/**
 * `/app/cross` — hub cross-alerts (Sprint 27 Faixa C).
 *
 * KPIs agregados + atalho pras filas operacionais (alertas, adaptações).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function CrossHubPage() {
  const session = await requireFullSession('/app/cross')
  const tenantId = session.logifit.tenantId

  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM member_injury_alerts WHERE tenant_id = ${tenantId} AND status = 'pending_review') AS pending,
        (SELECT COUNT(*)::int FROM member_injury_alerts WHERE tenant_id = ${tenantId} AND status = 'accepted' AND created_at > NOW() - INTERVAL '30 days') AS accepted_30d,
        (SELECT COUNT(*)::int FROM member_injury_alerts WHERE tenant_id = ${tenantId} AND status = 'rejected' AND created_at > NOW() - INTERVAL '30 days') AS rejected_30d,
        (SELECT COUNT(*)::int FROM member_injury_alerts WHERE tenant_id = ${tenantId} AND status = 'blocked' AND created_at > NOW() - INTERVAL '30 days') AS blocked_30d,
        (SELECT COUNT(*)::int FROM workout_adaptations WHERE tenant_id = ${tenantId} AND status = 'suggested') AS adaptations_pending
    `)
  ).rows as Array<{
    pending: number
    accepted_30d: number
    rejected_30d: number
    blocked_30d: number
    adaptations_pending: number
  }>

  const kpi = k ?? {
    pending: 0,
    accepted_30d: 0,
    rejected_30d: 0,
    blocked_30d: 0,
    adaptations_pending: 0,
  }

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
        <h1 style={{ margin: 0 }}>Cross-alerts</h1>
        <span style={{ color: 'var(--ev-muted)' }}>
          Sprint 27 · lesão Fisio → adaptação Academia (ADR 0084)
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/cross/alertas" className="ev-btn ev-btn-ghost">
          🚨 Todos os alertas
        </Link>
        <Link href="/app/treinos/adaptacao-pendente" className="ev-btn ev-btn-primary">
          🧬 Fila do instrutor
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
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Pendentes review
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.pending}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Adaptações suggested
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>
            {kpi.adaptations_pending}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Aceitos 30d
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.accepted_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Rejeitados 30d
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.rejected_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Bloqueados 30d
          </div>
          <div
            style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600, color: 'var(--ev-warning)' }}
          >
            {kpi.blocked_30d}
          </div>
        </div>
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Como funciona</h2>
        <ol style={{ paddingLeft: '1.25rem' }}>
          <li>Profissional fisio registra CID de lesão em consulta (Sprint 20)</li>
          <li>
            Dispatcher avalia regras: consent <code>cross_module_share</code> ativo + topology +
            contrato Academia ativo + workout ativo
          </li>
          <li>Se ok: gera sugestão de adaptação da ficha (regra 25 + ADR 0084)</li>
          <li>
            Instrutor revisa em <code>/app/treinos/adaptacao-pendente</code> e confirma
          </li>
          <li>Nova versão do workout é criada e atribuída automaticamente</li>
        </ol>
      </section>
    </div>
  )
}
