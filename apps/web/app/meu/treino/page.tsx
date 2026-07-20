import { pool } from '@repo/db/client'
/**
 * /meu/treino — ficha de treino + sessões. Sprint 26 Faixa C (26b).
 *
 * Mostra a prescription ativa (kind=workout) + itens (sets/reps/load) +
 * histórico recente de sessões. Vídeo de exercício usa URL assinada MinIO
 * (Sprint 11) — placeholder pra Sprint 26c quando adapter de storage tiver
 * `signedUrl(path, ttl)` exposto via Server Action.
 */
import Link from 'next/link'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface ActivePrescription {
  prescription_id: string
  workout_id: string
  workout_name: string
  workout_goal: string | null
  starts_at: Date
  ends_at: Date | null
}

interface WorkoutItem {
  id: string
  order: number
  exercise_name: string
  exercise_muscle_groups: string[]
  exercise_video_path: string | null
  sets: number
  reps: string
  load_kg: string | null
  rest_seconds: number
  notes: string | null
  superset_group: number | null
}

interface SessionRow {
  id: string
  started_at: Date
  finished_at: Date | null
  overall_rpe: number | null
  calculated_kcal: string | null
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default async function MeuTreinoPage() {
  const ctx = await requireMemberOrPassport('/meu/treino')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="seus treinos" />
  }
  const session = ctx.claims

  const { prescription, items, sessions } = await withMemberContext(session, async () => {
    const presRes = await pool.query<ActivePrescription>(
      `SELECT p.id AS prescription_id, p.ref_id AS workout_id,
              w.name AS workout_name, w.goal AS workout_goal,
              p.starts_at, p.ends_at
       FROM prescriptions p
       JOIN workouts w ON w.id = p.ref_id
       WHERE p.member_id = $1 AND p.kind = 'workout' AND p.active = true
       ORDER BY p.starts_at DESC
       LIMIT 1`,
      [session.memberId],
    )
    const pres = presRes.rows[0] ?? null
    if (!pres) {
      return { prescription: null, items: [], sessions: [] as SessionRow[] }
    }
    const itemsRes = await pool.query<WorkoutItem>(
      `SELECT wi.id, wi."order", e.name AS exercise_name, e.muscle_groups AS exercise_muscle_groups,
              e.video_storage_path AS exercise_video_path,
              wi.sets, wi.reps, wi.load_kg, wi.rest_seconds, wi.notes, wi.superset_group
       FROM workout_items wi
       JOIN exercises e ON e.id = wi.exercise_id
       WHERE wi.workout_id = $1
       ORDER BY wi."order" ASC`,
      [pres.workout_id],
    )
    const sesRes = await pool.query<SessionRow>(
      `SELECT id, started_at, finished_at, overall_rpe, calculated_kcal
       FROM workout_sessions
       WHERE prescription_id = $1
       ORDER BY started_at DESC
       LIMIT 5`,
      [pres.prescription_id],
    )
    return { prescription: pres, items: itemsRes.rows, sessions: sesRes.rows }
  })

  if (!prescription) {
    return (
      <div className="ev-portal-page">
        <header>
          <h1 className="ev-portal-h1">Treino</h1>
        </header>
        <div className="ev-portal-empty">
          Você ainda não tem uma ficha ativa.
          <br />
          Converse com seu instrutor.
        </div>
      </div>
    )
  }

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">{prescription.workout_name}</h1>
        <p className="ev-portal-muted">
          {prescription.workout_goal ?? 'Ficha ativa'} · prescrito em{' '}
          {formatDate(prescription.starts_at)}
        </p>
      </header>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Exercícios</h2>
        <ol className="ev-portal-list">
          {items.map((it) => (
            <li key={it.id} className="ev-portal-list-item">
              <div className="ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">
                    {it.order}. {it.exercise_name}
                  </div>
                  <div className="ev-portal-muted">
                    {it.sets} × {it.reps}
                    {it.load_kg ? ` · ${it.load_kg}kg` : ''} · descanso {it.rest_seconds}s
                  </div>
                </div>
                {it.superset_group != null ? (
                  <span className="ev-portal-badge ev-portal-badge--info">
                    superset {it.superset_group}
                  </span>
                ) : null}
              </div>
              {it.notes ? <p className="ev-portal-muted">{it.notes}</p> : null}
              {it.exercise_muscle_groups.length > 0 ? (
                <div style={{ display: 'flex', gap: 'var(--ev-space-1)', flexWrap: 'wrap' }}>
                  {it.exercise_muscle_groups.map((g) => (
                    <span key={g} className="ev-portal-badge">
                      {g}
                    </span>
                  ))}
                </div>
              ) : null}
              {it.exercise_video_path ? (
                <span className="ev-portal-muted">Vídeo demonstrativo disponível na execução</span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {sessions.length > 0 ? (
        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Sessões recentes</h2>
          <ul className="ev-portal-list">
            {sessions.map((s) => (
              <li key={s.id} className="ev-portal-list-item ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">{formatDate(s.started_at)}</div>
                  <div className="ev-portal-muted">
                    {s.finished_at ? 'Concluído' : 'Em andamento'}
                    {s.overall_rpe ? ` · RPE ${s.overall_rpe}` : ''}
                    {s.calculated_kcal ? ` · ${Number(s.calculated_kcal).toFixed(0)} kcal` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link href="/meu" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
