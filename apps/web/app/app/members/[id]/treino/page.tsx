import { db } from '@repo/db/client'
import { members, persons, prescriptions, workoutSessions, workouts } from '@repo/db/schema'
/**
 * `/app/members/[id]/treino` — ficha de treino do member (Sprint 11 Faixa C).
 *
 * Mostra prescrições ativas + histórico. Permite prescrever novo workout
 * (form embutido) + iniciar sessão.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { PrescribeWorkoutForm } from './prescribe-form'
import { StartSessionButton } from './start-session-button'

export const dynamic = 'force-dynamic'

export default async function MemberTreinoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/members/${id}/treino`)
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({
      id: members.id,
      personName: persons.name,
      archivedAt: members.archivedAt,
    })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, id), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  // Prescrições ativas (active=true)
  const activePrescriptions = await db
    .select({
      id: prescriptions.id,
      kind: prescriptions.kind,
      refId: prescriptions.refId,
      startsAt: prescriptions.startsAt,
      endsAt: prescriptions.endsAt,
      notes: prescriptions.notes,
      workoutName: workouts.name,
      workoutGoal: workouts.goal,
      workoutVersion: workouts.version,
      workoutDurationMin: workouts.estimatedDurationMin,
    })
    .from(prescriptions)
    .leftJoin(
      workouts,
      and(eq(workouts.id, prescriptions.refId), eq(prescriptions.kind, 'workout')),
    )
    .where(
      and(
        eq(prescriptions.tenantId, tenantId),
        eq(prescriptions.memberId, id),
        eq(prescriptions.active, true),
      ),
    )
    .orderBy(desc(prescriptions.createdAt))

  // Sessões recentes
  const recentSessions = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      finishedAt: workoutSessions.finishedAt,
      overallRpe: workoutSessions.overallRpe,
      calculatedKcal: workoutSessions.calculatedKcal,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.tenantId, tenantId), eq(workoutSessions.memberId, id)))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(10)

  // Workouts disponíveis pra prescrever
  const availableWorkouts = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      goal: workouts.goal,
      version: workouts.version,
    })
    .from(workouts)
    .where(and(eq(workouts.tenantId, tenantId), isNull(workouts.archivedAt)))
    .orderBy(asc(workouts.name))
    .limit(100)

  // Sessão ativa (started_at sem finished_at) — abre direct se houver
  const activeSession = recentSessions.find((s) => s.finishedAt === null) ?? null

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${id}`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pro perfil
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Treinos · {member.personName}</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          {activePrescriptions.length} prescrição(ões) ativa(s) · {recentSessions.length}{' '}
          sessão(ões) recente(s)
        </p>
      </header>

      {activeSession && (
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--ev-warning, #eab308)',
            backgroundColor: 'var(--ev-warning-bg, #fef3c7)',
          }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="font-semibold">⏱️ Sessão em andamento</h2>
              <p className="text-sm">
                Iniciada{' '}
                {new Date(activeSession.startedAt).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <Link
              href={`/app/members/${id}/treino/sessao/${activeSession.id}`}
              className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90"
            >
              Continuar sessão →
            </Link>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Prescrições ativas
        </h2>
        {activePrescriptions.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma prescrição ativa. Use o form abaixo pra prescrever.
          </p>
        ) : (
          <ul className="space-y-3">
            {activePrescriptions.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-4 space-y-2"
              >
                <header className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-medium leading-tight truncate">
                      {p.kind === 'workout'
                        ? (p.workoutName ?? '(workout removido)')
                        : `Prescrição ${p.kind}`}
                    </h3>
                    <p className="text-xs text-[color:var(--ev-text-muted)]">
                      {p.workoutGoal && `${p.workoutGoal} · `}
                      {p.workoutVersion && `v${p.workoutVersion} · `}
                      {p.workoutDurationMin && `~${p.workoutDurationMin}min · `}
                      desde {new Date(p.startsAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {p.kind === 'workout' && p.refId && (
                      <Link
                        href={`/app/treinos/${p.refId}`}
                        className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-xs hover:bg-[color:var(--ev-surface)]"
                      >
                        Ver ficha
                      </Link>
                    )}
                    {!activeSession && <StartSessionButton prescriptionId={p.id} memberId={id} />}
                  </div>
                </header>
                {p.notes && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] italic">{p.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!member.archivedAt && availableWorkouts.length > 0 && (
        <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Prescrever workout
          </h2>
          <PrescribeWorkoutForm memberId={id} workouts={availableWorkouts} />
        </section>
      )}

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Histórico de sessões
        </h2>
        {recentSessions.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhuma sessão registrada ainda.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentSessions.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {new Date(s.startedAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="text-xs text-[color:var(--ev-text-muted)]">
                    {s.finishedAt
                      ? `Finalizada · ${Math.round(
                          (new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()) /
                            60000,
                        )}min`
                      : 'Em andamento'}
                    {s.overallRpe && ` · RPE ${s.overallRpe}/10`}
                    {s.calculatedKcal && ` · ${Math.round(Number(s.calculatedKcal))}kcal`}
                  </div>
                </div>
                {!s.finishedAt && (
                  <Link
                    href={`/app/members/${id}/treino/sessao/${s.id}`}
                    className="text-xs text-[color:var(--ev-primary)] hover:underline"
                  >
                    continuar →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
