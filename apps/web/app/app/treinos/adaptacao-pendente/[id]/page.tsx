/**
 * `/app/treinos/adaptacao-pendente/[id]` — detalhe + confirmar/rejeitar.
 *   Sprint 27 Faixa C.
 *
 * Mostra diff visual (verde = adicionado, vermelho = removido, amarelo =
 * substituído). Botões chamam Server Actions `confirmAdaptation` / `rejectAdaptation`.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'
import { AdaptationActions } from './actions-buttons'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface ChangesDiff {
  summary?: string
  removed?: Array<{ itemId: string; exerciseId: string; exerciseName: string; reason: string }>
  replaced?: Array<{
    fromItemId: string
    fromExerciseId: string
    toExerciseId: string
    toExerciseName: string
    rationale: string
  }>
  added?: Array<{ exerciseId: string; exerciseName: string; sets: number; reps: string }>
  avoidCount?: number
  modifyCount?: number
  cautionCount?: number
}

export default async function AdaptationDetailPage({ params }: PageProps) {
  const session = await requireFullSession('/app/treinos/adaptacao-pendente')
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const [row] = (
    await db.execute(sql`
      SELECT
        wa.id,
        wa.alert_id,
        wa.original_workout_id,
        wa.adapted_workout_id,
        wa.changes,
        wa.status,
        wa.rejection_reason,
        wa.confirmed_at,
        wa.created_at,
        w.name AS original_workout_name,
        a.member_id,
        p.name AS member_name,
        a.primary_cid_code,
        c.description AS cid_description,
        a.expires_at,
        a.status AS alert_status
      FROM workout_adaptations wa
      INNER JOIN member_injury_alerts a ON a.id = wa.alert_id
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN persons p ON p.id = m.person_id
      LEFT JOIN cid_catalog c ON c.code = a.primary_cid_code
      LEFT JOIN workouts w ON w.id = wa.original_workout_id
      WHERE wa.id = ${id} AND wa.tenant_id = ${tenantId}
      LIMIT 1
    `)
  ).rows as Array<{
    id: string
    alert_id: string
    original_workout_id: string
    adapted_workout_id: string | null
    changes: ChangesDiff
    status: string
    rejection_reason: string | null
    confirmed_at: string | null
    created_at: string
    original_workout_name: string | null
    member_id: string
    member_name: string | null
    primary_cid_code: string
    cid_description: string | null
    expires_at: string
    alert_status: string
  }>

  if (!row) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Adaptação não encontrada</h1>
        <Link href="/app/treinos/adaptacao-pendente">Voltar</Link>
      </div>
    )
  }

  const changes = row.changes ?? {}
  const canAct = row.status === 'suggested'

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>Adaptação · {row.original_workout_name ?? '—'}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>{row.status}</span>
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
        <dd style={{ margin: 0 }}>{row.member_name ?? row.member_id}</dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>CID</dt>
        <dd style={{ margin: 0 }}>
          <code>{row.primary_cid_code}</code>
          {row.cid_description ? ` — ${row.cid_description}` : ''}
        </dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>Criado em</dt>
        <dd style={{ margin: 0 }}>{new Date(row.created_at).toLocaleString('pt-BR')}</dd>

        <dt style={{ color: 'var(--ev-text-muted)' }}>Expira</dt>
        <dd style={{ margin: 0 }}>{new Date(row.expires_at).toLocaleDateString('pt-BR')}</dd>

        {row.rejection_reason ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Motivo rejeição</dt>
            <dd style={{ margin: 0 }}>{row.rejection_reason}</dd>
          </>
        ) : null}
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Diff sugerido</h2>
        {changes.summary ? (
          <p style={{ marginTop: 0, color: 'var(--ev-text-muted)' }}>{changes.summary}</p>
        ) : null}

        {(changes.replaced ?? []).length > 0 && (
          <div style={{ marginTop: 'var(--ev-space-md)' }}>
            <h3 style={{ marginBottom: 'var(--ev-space-2)' }}>Substituições</h3>
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
              {(changes.replaced ?? []).map((rep, i) => (
                <li
                  key={i}
                  style={{
                    background: 'var(--ev-warning-soft, #fef3c7)',
                    padding: 'var(--ev-space-2)',
                    borderRadius: 'var(--ev-radius-md)',
                    border: '1px solid var(--ev-warning, #f59e0b)',
                  }}
                >
                  <div>
                    <s style={{ color: 'var(--ev-danger)' }}>item {rep.fromItemId.slice(0, 8)}</s>{' '}
                    →{' '}
                    <strong style={{ color: 'var(--ev-success-hover)' }}>{rep.toExerciseName}</strong>
                  </div>
                  <small style={{ color: 'var(--ev-text-muted)' }}>{rep.rationale}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(changes.removed ?? []).length > 0 && (
          <div style={{ marginTop: 'var(--ev-space-md)' }}>
            <h3 style={{ marginBottom: 'var(--ev-space-2)' }}>Removidos (sem alternativa)</h3>
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
              {(changes.removed ?? []).map((rm, i) => (
                <li
                  key={i}
                  style={{
                    background: 'var(--ev-danger-soft, #fee2e2)',
                    padding: 'var(--ev-space-2)',
                    borderRadius: 'var(--ev-radius-md)',
                    border: '1px solid var(--ev-danger, #b91c1c)',
                  }}
                >
                  <div>
                    <s>{rm.exerciseName}</s>
                  </div>
                  <small style={{ color: 'var(--ev-text-muted)' }}>{rm.reason}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(changes.replaced ?? []).length === 0 && (changes.removed ?? []).length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Sem mudanças sugeridas — apenas pontos de atenção (caution).
          </p>
        ) : null}
      </section>

      {canAct ? (
        <AdaptationActions adaptationId={row.id} />
      ) : (
        <p style={{ color: 'var(--ev-text-muted)' }}>
          Adaptação já está em status <strong>{row.status}</strong> e não pode mais ser modificada.
        </p>
      )}

      <Link href="/app/treinos/adaptacao-pendente" className="ev-btn ev-btn-ghost">
        ← Voltar à fila
      </Link>
    </div>
  )
}
