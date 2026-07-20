'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { finishSession, recordSessionItem } from '../../../../../treinos/actions'

interface WorkoutItem {
  id: string
  order: number
  sets: number
  reps: string
  loadKg: string | null
  restSeconds: number
  notes: string | null
  exerciseName: string | null
}

interface RecordedSet {
  workoutItemId: string
  setNumber: number
  repsPerformed: number | null
  weightKg: string | null
  rpe: number | null
}

interface SetDraft {
  repsPerformed: string
  weightKg: string
  rpe: string
}

interface Props {
  sessionId: string
  memberId: string
  items: WorkoutItem[]
  recordedSets: RecordedSet[]
}

export function SessionExecutionPanel({ sessionId, memberId, items, recordedSets }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [finishing, startFinish] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showFinishPanel, setShowFinishPanel] = useState(false)
  const [overallRpe, setOverallRpe] = useState<string>('')
  const [finishNotes, setFinishNotes] = useState<string>('')

  // Index recorded por (item, set) pra detectar quais já tem registro
  const recordedKey = useMemo(() => {
    const map = new Map<string, RecordedSet>()
    for (const r of recordedSets) {
      map.set(`${r.workoutItemId}:${r.setNumber}`, r)
    }
    return map
  }, [recordedSets])

  // Drafts em memória (workoutItemId → setNumber → draft)
  const [drafts, setDrafts] = useState<Record<string, Record<number, SetDraft>>>({})

  function getDraft(itemId: string, setNum: number): SetDraft {
    return (
      drafts[itemId]?.[setNum] ?? {
        repsPerformed: '',
        weightKg: '',
        rpe: '',
      }
    )
  }

  function updateDraft(itemId: string, setNum: number, patch: Partial<SetDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [setNum]: { ...getDraft(itemId, setNum), ...patch },
      },
    }))
  }

  function recordSet(itemId: string, setNum: number) {
    setError(null)
    const draft = getDraft(itemId, setNum)
    if (!draft.repsPerformed && !draft.weightKg && !draft.rpe) {
      setError('Preencha ao menos um campo (reps / carga / RPE)')
      return
    }
    startTransition(async () => {
      const result = await recordSessionItem({
        sessionId,
        workoutItemId: itemId,
        setNumber: setNum,
        repsPerformed: draft.repsPerformed ? Number(draft.repsPerformed) : undefined,
        weightKg: draft.weightKg ? Number(draft.weightKg) : undefined,
        rpe: draft.rpe ? Number(draft.rpe) : undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function confirmFinish() {
    setError(null)
    const rpe = overallRpe ? Number(overallRpe) : undefined
    if (rpe !== undefined && (rpe < 1 || rpe > 10)) {
      setError('RPE deve ser entre 1 e 10')
      return
    }
    startFinish(async () => {
      const result = await finishSession({
        sessionId,
        overallRpe: rpe,
        notes: finishNotes.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push(`/app/members/${memberId}/treino`)
      router.refresh()
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
        Esta prescrição não tem workout items configurados.
        <button
          type="button"
          onClick={confirmFinish}
          disabled={finishing}
          className="ml-3 rounded-md bg-[color:var(--ev-primary)] px-3 py-1.5 text-xs text-white hover:opacity-90"
        >
          {finishing ? 'Finalizando...' : 'Finalizar sessão vazia'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      {items.map((it, idx) => (
        <section
          key={it.id}
          className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3"
        >
          <header className="space-y-1">
            <h2 className="font-medium">
              {idx + 1}. {it.exerciseName ?? '(exercício removido)'}
            </h2>
            <p className="text-xs text-[color:var(--ev-text-muted)]">
              {it.sets} séries × {it.reps} reps
              {it.loadKg && ` · sugestão ${it.loadKg}kg`} · descanso {it.restSeconds}s
            </p>
            {it.notes && (
              <p className="text-xs italic text-[color:var(--ev-text-muted)]">{it.notes}</p>
            )}
          </header>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[color:var(--ev-text-muted)] uppercase">
                <th className="text-left py-1 w-12">Série</th>
                <th className="text-left py-1">Reps feitas</th>
                <th className="text-left py-1">Carga (kg)</th>
                <th className="text-left py-1">RPE</th>
                <th className="text-left py-1">Ação</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: it.sets }).map((_, sIdx) => {
                const setNum = sIdx + 1
                const recorded = recordedKey.get(`${it.id}:${setNum}`)
                if (recorded) {
                  return (
                    <tr key={setNum} className="border-t border-[color:var(--ev-border)]">
                      <td className="py-2 font-medium tabular-nums">{setNum}</td>
                      <td className="py-2 tabular-nums">{recorded.repsPerformed ?? '—'}</td>
                      <td className="py-2 tabular-nums">{recorded.weightKg ?? '—'}</td>
                      <td className="py-2 tabular-nums">{recorded.rpe ?? '—'}</td>
                      <td className="py-2 text-xs" style={{ color: 'var(--ev-success, #22c55e)' }}>
                        ✓ registrado
                      </td>
                    </tr>
                  )
                }
                const draft = getDraft(it.id, setNum)
                return (
                  <tr key={setNum} className="border-t border-[color:var(--ev-border)]">
                    <td className="py-2 font-medium tabular-nums">{setNum}</td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={draft.repsPerformed}
                        onChange={(e) =>
                          updateDraft(it.id, setNum, { repsPerformed: e.target.value })
                        }
                        className="w-20 rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        step="0.5"
                        value={draft.weightKg}
                        onChange={(e) => updateDraft(it.id, setNum, { weightKg: e.target.value })}
                        className="w-20 rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={draft.rpe}
                        onChange={(e) => updateDraft(it.id, setNum, { rpe: e.target.value })}
                        className="w-16 rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => recordSet(it.id, setNum)}
                        disabled={pending}
                        className="rounded-md border border-[color:var(--ev-border)] px-2 py-1 text-xs hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
                      >
                        Registrar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}

      {showFinishPanel ? (
        <section
          className="rounded-xl border-2 p-5 space-y-4"
          style={{ borderColor: 'var(--ev-primary)' }}
        >
          <h2 className="font-semibold">Finalizar sessão</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">RPE geral (1-10, opcional)</span>
              <input
                type="number"
                min="1"
                max="10"
                value={overallRpe}
                onChange={(e) => setOverallRpe(e.target.value)}
                placeholder="7"
                className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="block font-medium">Notas (opcional)</span>
              <textarea
                rows={2}
                value={finishNotes}
                onChange={(e) => setFinishNotes(e.target.value)}
                placeholder="Como foi a sessão?"
                className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowFinishPanel(false)}
              disabled={finishing}
              className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 text-sm hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmFinish}
              disabled={finishing}
              className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {finishing ? 'Finalizando...' : '✓ Confirmar'}
            </button>
          </div>
        </section>
      ) : (
        <div className="flex justify-end gap-2 sticky bottom-4">
          <button
            type="button"
            onClick={() => setShowFinishPanel(true)}
            disabled={finishing}
            className="rounded-md bg-[color:var(--ev-primary)] px-6 py-3 text-sm font-medium text-white shadow-lg hover:opacity-90 disabled:opacity-50"
          >
            ✓ Finalizar sessão
          </button>
        </div>
      )}
    </div>
  )
}
