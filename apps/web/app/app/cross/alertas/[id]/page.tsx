/**
 * `/app/cross/alertas/[id]` — detalhe do alerta (Sprint 27 Faixa C).
 *
 * Mostra paciente, CID, status, motivo bloqueio se houver, link pra consulta
 * de origem (read-only) e pra adaptação relacionada (se existe).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AlertDetailPage({ params }: PageProps) {
  const session = await requireFullSession(`/app/cross/alertas`)
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const [alert] = (
    await db.execute(sql`
      SELECT
        a.id,
        a.member_id,
        p.name AS member_name,
        a.primary_cid_code,
        a.secondary_cid_codes,
        c.description AS cid_description,
        a.status,
        a.blocked_reason,
        a.source_company_id,
        a.target_company_id,
        a.source_consulta_id,
        a.consent_id_used,
        a.reviewed_by_user_id,
        a.reviewed_at,
        a.rejection_reason,
        a.created_at,
        a.expires_at,
        (SELECT id FROM workout_adaptations WHERE alert_id = a.id LIMIT 1) AS adaptation_id,
        (SELECT status FROM workout_adaptations WHERE alert_id = a.id LIMIT 1) AS adaptation_status
      FROM member_injury_alerts a
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN persons p ON p.id = m.person_id
      LEFT JOIN cid_catalog c ON c.code = a.primary_cid_code
      WHERE a.id = ${id} AND a.tenant_id = ${tenantId}
      LIMIT 1
    `)
  ).rows as Array<{
    id: string
    member_id: string
    member_name: string | null
    primary_cid_code: string
    secondary_cid_codes: string[] | null
    cid_description: string | null
    status: string
    blocked_reason: string | null
    source_company_id: string | null
    target_company_id: string | null
    source_consulta_id: string
    consent_id_used: string | null
    reviewed_by_user_id: string | null
    reviewed_at: string | null
    rejection_reason: string | null
    created_at: string
    expires_at: string
    adaptation_id: string | null
    adaptation_status: string | null
  }>

  if (!alert) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Alerta não encontrado</h1>
        <Link href="/app/cross/alertas">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Alerta {alert.id.slice(0, 8)}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Criado em {new Date(alert.created_at).toLocaleString('pt-BR')}
        </span>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--ev-space-sm) var(--ev-space-md)',
        }}
      >
        <dt style={{ color: 'var(--ev-text-muted)' }}>Paciente</dt>
        <dd style={{ margin: 0 }}>{alert.member_name ?? alert.member_id}</dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>CID principal</dt>
        <dd style={{ margin: 0 }}>
          <code>{alert.primary_cid_code}</code>{' '}
          {alert.cid_description ? `— ${alert.cid_description}` : ''}
        </dd>

        {alert.secondary_cid_codes && alert.secondary_cid_codes.length > 0 ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>CIDs secundários</dt>
            <dd style={{ margin: 0 }}>{alert.secondary_cid_codes.join(', ')}</dd>
          </>
        ) : null}

        <dt style={{ color: 'var(--ev-text-muted)' }}>Status</dt>
        <dd style={{ margin: 0 }}>{alert.status}</dd>

        {alert.blocked_reason ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Motivo bloqueio</dt>
            <dd style={{ margin: 0, color: 'var(--ev-danger)' }}>{alert.blocked_reason}</dd>
          </>
        ) : null}

        <dt style={{ color: 'var(--ev-text-muted)' }}>Consulta de origem</dt>
        <dd style={{ margin: 0 }}>
          <Link href={`/fisio/consultas/${alert.source_consulta_id}`}>
            {alert.source_consulta_id.slice(0, 8)}
          </Link>
        </dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>Consent usado</dt>
        <dd style={{ margin: 0 }}>
          {alert.consent_id_used ? (
            <code>{alert.consent_id_used.slice(0, 8)}</code>
          ) : (
            <span style={{ color: 'var(--ev-text-muted)' }}>nenhum</span>
          )}
        </dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>Expira em</dt>
        <dd style={{ margin: 0 }}>{new Date(alert.expires_at).toLocaleString('pt-BR')}</dd>

        {alert.reviewed_at ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Revisado em</dt>
            <dd style={{ margin: 0 }}>{new Date(alert.reviewed_at).toLocaleString('pt-BR')}</dd>
            {alert.rejection_reason ? (
              <>
                <dt style={{ color: 'var(--ev-text-muted)' }}>Motivo rejeição</dt>
                <dd style={{ margin: 0 }}>{alert.rejection_reason}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {alert.adaptation_id ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h2 style={{ marginTop: 0 }}>Adaptação relacionada</h2>
          <p>
            Status: <strong>{alert.adaptation_status}</strong>
          </p>
          <Link
            href={`/app/treinos/adaptacao-pendente/${alert.adaptation_id}`}
            className="ev-btn ev-btn-primary"
          >
            Ver adaptação
          </Link>
        </section>
      ) : null}

      <Link href="/app/cross/alertas" className="ev-btn ev-btn-ghost">
        ← Todos os alertas
      </Link>
    </div>
  )
}
