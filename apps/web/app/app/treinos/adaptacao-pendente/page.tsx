/**
 * `/app/treinos/adaptacao-pendente` — fila do instrutor (Sprint 27 Faixa C).
 *
 * Lista todas as `workout_adaptations` status='suggested' do tenant com:
 *   - paciente, CID principal, workout original, counts (avoid/modify/caution)
 *   - link pra detalhe (confirmar / rejeitar com diff visual)
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function FilaAdaptacaoPage() {
  const session = await requireFullSession('/app/treinos/adaptacao-pendente')
  const tenantId = session.logifit.tenantId

  const rows = (
    await db.execute(sql`
      SELECT
        wa.id AS adaptation_id,
        wa.alert_id,
        wa.original_workout_id,
        w.name AS workout_name,
        wa.changes,
        wa.created_at,
        a.member_id,
        p.name AS member_name,
        a.primary_cid_code,
        c.description AS cid_description,
        a.expires_at
      FROM workout_adaptations wa
      INNER JOIN member_injury_alerts a ON a.id = wa.alert_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN persons p ON p.id = m.person_id
      LEFT JOIN cid_catalog c ON c.code = a.primary_cid_code
      LEFT JOIN workouts w ON w.id = wa.original_workout_id
      WHERE wa.tenant_id = ${tenantId} AND wa.status = 'suggested'
      ORDER BY wa.created_at DESC
      LIMIT 100
    `)
  ).rows as Array<{
    adaptation_id: string
    alert_id: string
    original_workout_id: string
    workout_name: string | null
    changes: {
      summary?: string
      avoidCount?: number
      modifyCount?: number
      cautionCount?: number
    } | null
    created_at: string
    member_id: string
    member_name: string | null
    primary_cid_code: string
    cid_description: string | null
    expires_at: string
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Fila do instrutor</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {rows.length} adaptação(ões) aguardando revisão
        </span>
      </header>

      {rows.length === 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Nenhuma adaptação pendente. Quando um fisioterapeuta registrar CID de lesão em
            paciente que também é aluno, a sugestão aparecerá aqui.
          </p>
        </section>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-md)' }}>
          {rows.map((r) => (
            <li key={r.adaptation_id}>
              <Link
                href={`/app/treinos/adaptacao-pendente/${r.adaptation_id}`}
                className="ev-card"
                style={{
                  padding: 'var(--ev-space-md)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 'var(--ev-space-md)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {r.member_name ?? r.member_id} · {r.workout_name ?? 'workout'}
                  </div>
                  <div style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
                    CID <code>{r.primary_cid_code}</code>
                    {r.cid_description ? ` — ${r.cid_description}` : ''}
                  </div>
                  {r.changes?.summary ? (
                    <p style={{ marginTop: 'var(--ev-space-2)' }}>{r.changes.summary}</p>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  {(r.changes?.avoidCount ?? 0) > 0 ? (
                    <span style={{ color: 'var(--ev-danger)', fontWeight: 600 }}>
                      {r.changes!.avoidCount} avoid
                    </span>
                  ) : null}
                  {(r.changes?.modifyCount ?? 0) > 0 ? (
                    <span style={{ color: 'var(--ev-warning)' }}>
                      {r.changes!.modifyCount} modify
                    </span>
                  ) : null}
                  {(r.changes?.cautionCount ?? 0) > 0 ? (
                    <span style={{ color: 'var(--ev-text-muted)' }}>
                      {r.changes!.cautionCount} caution
                    </span>
                  ) : null}
                  <span style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                    Expira em {new Date(r.expires_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
