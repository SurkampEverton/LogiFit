/**
 * `/app/treinos/[id]` — detalhe do workout com lista de items expandida
 * (Sprint 11 Faixa C). Read-only MVP — edição cria nova versão via
 * `/app/treinos/[id]/edit` (Faixa D+).
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { exercises, workoutItems, workouts } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/treinos/${id}`)
  const tenantId = session.logifit.tenantId

  const [w] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.tenantId, tenantId)))
    .limit(1)
  if (!w) notFound()

  const items = await db
    .select({
      id: workoutItems.id,
      order: workoutItems.order,
      sets: workoutItems.sets,
      reps: workoutItems.reps,
      loadKg: workoutItems.loadKg,
      restSeconds: workoutItems.restSeconds,
      notes: workoutItems.notes,
      supersetGroup: workoutItems.supersetGroup,
      exerciseName: exercises.name,
      exerciseLevel: exercises.level,
      exerciseMet: exercises.metValue,
      exerciseMuscleGroups: exercises.muscleGroups,
    })
    .from(workoutItems)
    .leftJoin(exercises, eq(exercises.id, workoutItems.exerciseId))
    .where(eq(workoutItems.workoutId, id))
    .orderBy(asc(workoutItems.order))

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{w.name}</h1>
            <p className="text-sm text-[color:var(--ev-text-muted)]">
              v{w.version}
              {w.parentWorkoutId && (
                <>
                  {' '}
                  · evolução de{' '}
                  <Link
                    href={`/app/treinos/${w.parentWorkoutId}`}
                    className="underline"
                  >
                    versão anterior
                  </Link>
                </>
              )}
              {w.goal && ` · ${w.goal}`}
              {w.estimatedDurationMin && ` · ~${w.estimatedDurationMin}min`}
            </p>
          </div>
          <Link
            href="/app/treinos"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Lista
          </Link>
        </div>
        {w.description && (
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {w.description}
          </p>
        )}
      </header>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Exercícios ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Sem items.
          </p>
        ) : (
          <ol className="space-y-2">
            {items.map((it, idx) => (
              <li
                key={it.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 space-y-1"
              >
                <header className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium text-sm">
                    {idx + 1}. {it.exerciseName ?? '(exercício removido)'}
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)] flex gap-2 flex-wrap">
                    <span>
                      <strong className="text-[color:var(--ev-text)]">
                        {it.sets}
                      </strong>{' '}
                      séries
                    </span>
                    <span>
                      ×{' '}
                      <strong className="text-[color:var(--ev-text)]">
                        {it.reps}
                      </strong>{' '}
                      reps
                    </span>
                    {it.loadKg && (
                      <span>
                        ·{' '}
                        <strong className="text-[color:var(--ev-text)]">
                          {it.loadKg}kg
                        </strong>
                      </span>
                    )}
                    <span>
                      · descanso{' '}
                      <strong className="text-[color:var(--ev-text)]">
                        {it.restSeconds}s
                      </strong>
                    </span>
                    {it.supersetGroup !== null && it.supersetGroup !== undefined && (
                      <span
                        className="rounded-full bg-[color:var(--ev-warning-bg, #fef3c7)] px-2 py-0.5"
                        style={{ color: 'var(--ev-warning, #92400e)' }}
                      >
                        Superset #{it.supersetGroup}
                      </span>
                    )}
                  </div>
                </header>
                {it.notes && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] italic">
                    {it.notes}
                  </p>
                )}
                {it.exerciseMuscleGroups && it.exerciseMuscleGroups.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {it.exerciseMuscleGroups.map((mg) => (
                      <span
                        key={mg}
                        className="rounded-full bg-[color:var(--ev-surface)] px-2 py-0.5 text-[10px]"
                      >
                        {mg}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="text-xs text-[color:var(--ev-text-muted)]">
        Pra prescrever este workout a um member, vá em{' '}
        <Link href="/app/members" className="underline">
          Members
        </Link>{' '}
        → escolha o member → aba "Treino" → "Prescrever workout".
      </div>
    </div>
  )
}
