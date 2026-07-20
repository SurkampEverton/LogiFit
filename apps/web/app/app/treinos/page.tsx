import { db } from '@repo/db/client'
import { workoutItems, workouts } from '@repo/db/schema'
/**
 * `/app/treinos` — lista de workouts do tenant (Sprint 11 Faixa C).
 *
 * MVP simples: lista tabular sem editor inline. Detail page `/app/treinos/[id]`
 * mostra items + permite criar nova versão (chama updateWorkout que cria
 * `version+1` com parent_workout_id).
 */
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function TreinosListPage() {
  const session = await requireFullSession('/app/treinos')
  const tenantId = session.logifit.tenantId

  // Lista só workouts "head of chain" (sem ninguém apontando como parent).
  // MVP simples: lista todas — versionamento mostra parent_workout_id no detail.
  const rows = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      goal: workouts.goal,
      estimatedDurationMin: workouts.estimatedDurationMin,
      version: workouts.version,
      parentWorkoutId: workouts.parentWorkoutId,
      createdAt: workouts.createdAt,
    })
    .from(workouts)
    .where(and(eq(workouts.tenantId, tenantId), isNull(workouts.archivedAt)))
    .orderBy(desc(workouts.createdAt))
    .limit(100)

  // Counts de items por workout pra mostrar "12 exercícios" inline
  const itemCounts =
    rows.length > 0
      ? await db
          .select({
            workoutId: workoutItems.workoutId,
            n: count(workoutItems.id),
          })
          .from(workoutItems)
          .where(eq(workoutItems.tenantId, tenantId))
          .groupBy(workoutItems.workoutId)
      : []
  const countByWorkout = new Map(itemCounts.map((r) => [r.workoutId, Number(r.n)]))

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Treinos</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">{rows.length} workouts ativos</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/biblioteca/exercicios"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Biblioteca
          </Link>
          <Link
            href="/app/treinos/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo workout
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhum workout criado ainda. Comece adicionando exercícios à biblioteca, depois monte um
          treino.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <li key={w.id}>
              <Link
                href={`/app/treinos/${w.id}`}
                className="block rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 hover:border-[color:var(--ev-primary)] space-y-2"
              >
                <header className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-tight">{w.name}</h3>
                  <span className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5 text-[10px] uppercase">
                    v{w.version}
                  </span>
                </header>
                {w.goal && <p className="text-xs text-[color:var(--ev-text-muted)]">{w.goal}</p>}
                <dl className="flex gap-3 text-xs text-[color:var(--ev-text-muted)]">
                  <div>
                    <dt className="inline">Exercícios: </dt>
                    <dd className="inline font-medium tabular-nums">
                      {countByWorkout.get(w.id) ?? 0}
                    </dd>
                  </div>
                  {w.estimatedDurationMin && (
                    <div>
                      <dt className="inline">Duração: </dt>
                      <dd className="inline font-medium tabular-nums">
                        {w.estimatedDurationMin}min
                      </dd>
                    </div>
                  )}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
