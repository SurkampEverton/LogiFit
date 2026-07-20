import { db } from '@repo/db/client'
import { exercises } from '@repo/db/schema'
/**
 * `/app/treinos/new` — wizard de criação de workout (Sprint 11 Faixa C).
 *
 * MVP simples: form com header + lista de exercícios (add 1-a-1 via dropdown).
 * Drag-and-drop fica Faixa D+ (stretch).
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { NewWorkoutForm } from './new-workout-form'

export const dynamic = 'force-dynamic'

export default async function NewWorkoutPage() {
  const session = await requireFullSession('/app/treinos/new')
  const tenantId = session.logifit.tenantId

  const exerciseOptions = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      level: exercises.level,
      metValue: exercises.metValue,
      muscleGroups: exercises.muscleGroups,
      isGlobal: exercises.tenantId,
    })
    .from(exercises)
    .where(
      and(
        or(eq(exercises.tenantId, tenantId), isNull(exercises.tenantId)),
        eq(exercises.active, true),
        isNull(exercises.archivedAt),
      ),
    )
    .orderBy(asc(exercises.name))
    .limit(300)

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo workout</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Monte uma ficha de treino: header + exercícios ordenados.
          </p>
        </div>
        <Link
          href="/app/treinos"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewWorkoutForm
        exercises={exerciseOptions.map((e) => ({
          ...e,
          isGlobal: e.isGlobal === null,
        }))}
      />
    </div>
  )
}
