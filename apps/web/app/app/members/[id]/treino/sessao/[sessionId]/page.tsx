import { db } from '@repo/db/client'
import {
  exercises,
  prescriptions,
  workoutItems,
  workoutSessionItems,
  workoutSessions,
  workouts,
} from '@repo/db/schema'
/**
 * `/app/members/[id]/treino/sessao/[sessionId]` — UI de execução de sessão
 * (Sprint 11 Faixa C).
 *
 * Mostra workout items prescritos + capture set-a-set (reps performed, weight,
 * rpe por série). Botão "Finalizar sessão" coleta overall_rpe + notes e chama
 * finishSession (calcula kcal automaticamente).
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireFullSession } from '../../../../../../lib/session'
import { SessionExecutionPanel } from './session-execution-panel'

export const dynamic = 'force-dynamic'

export default async function SessionExecutionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>
}) {
  const { id: memberId, sessionId } = await params
  const session = await requireFullSession(`/app/members/${memberId}/treino/sessao/${sessionId}`)
  const tenantId = session.logifit.tenantId

  const [s] = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      finishedAt: workoutSessions.finishedAt,
      prescriptionId: workoutSessions.prescriptionId,
      memberId: workoutSessions.memberId,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.tenantId, tenantId)))
    .limit(1)
  if (!s) notFound()
  if (s.memberId !== memberId) notFound()
  if (s.finishedAt) {
    // Sessão já encerrada — redireciona pra ficha
    redirect(`/app/members/${memberId}/treino`)
  }

  const [p] = await db
    .select({
      refId: prescriptions.refId,
      kind: prescriptions.kind,
      workoutName: workouts.name,
    })
    .from(prescriptions)
    .leftJoin(workouts, eq(workouts.id, prescriptions.refId))
    .where(and(eq(prescriptions.id, s.prescriptionId), eq(prescriptions.tenantId, tenantId)))
    .limit(1)

  // Busca workout items se prescription é workout
  const items =
    p?.kind === 'workout' && p.refId
      ? await db
          .select({
            id: workoutItems.id,
            order: workoutItems.order,
            sets: workoutItems.sets,
            reps: workoutItems.reps,
            loadKg: workoutItems.loadKg,
            restSeconds: workoutItems.restSeconds,
            notes: workoutItems.notes,
            exerciseName: exercises.name,
            exerciseMet: exercises.metValue,
          })
          .from(workoutItems)
          .leftJoin(exercises, eq(exercises.id, workoutItems.exerciseId))
          .where(and(eq(workoutItems.workoutId, p.refId), eq(workoutItems.tenantId, tenantId)))
          .orderBy(asc(workoutItems.order))
      : []

  // Sets já registrados
  const recordedSets = await db
    .select({
      id: workoutSessionItems.id,
      workoutItemId: workoutSessionItems.workoutItemId,
      setNumber: workoutSessionItems.setNumber,
      repsPerformed: workoutSessionItems.repsPerformed,
      weightKg: workoutSessionItems.weightKg,
      rpe: workoutSessionItems.rpe,
      doneAt: workoutSessionItems.doneAt,
    })
    .from(workoutSessionItems)
    .where(
      and(eq(workoutSessionItems.sessionId, sessionId), eq(workoutSessionItems.tenantId, tenantId)),
    )
    .orderBy(asc(workoutSessionItems.doneAt))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${memberId}/treino`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pra ficha
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {p?.workoutName ?? 'Sessão de treino'}
        </h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Sessão iniciada em{' '}
          {new Date(s.startedAt).toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </p>
      </header>

      <SessionExecutionPanel
        sessionId={sessionId}
        memberId={memberId}
        items={items.map((it) => ({
          id: it.id,
          order: it.order,
          sets: it.sets,
          reps: it.reps,
          loadKg: it.loadKg,
          restSeconds: it.restSeconds,
          notes: it.notes,
          exerciseName: it.exerciseName,
        }))}
        recordedSets={recordedSets.map((r) => ({
          workoutItemId: r.workoutItemId,
          setNumber: r.setNumber,
          repsPerformed: r.repsPerformed,
          weightKg: r.weightKg,
          rpe: r.rpe,
        }))}
      />
    </main>
  )
}
