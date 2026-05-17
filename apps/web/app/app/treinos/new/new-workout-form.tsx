'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createWorkout } from '../actions'

interface ExerciseOption {
  id: string
  name: string
  level: string
  metValue: string
  muscleGroups: string[]
  isGlobal: boolean
}

interface ItemDraft {
  exerciseId: string
  exerciseName: string
  sets: number
  reps: string
  loadKg: number | null
  restSeconds: number
  notes: string
}

interface Props {
  exercises: ExerciseOption[]
}

export function NewWorkoutForm({ exercises }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ItemDraft[]>([])
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('')

  function addItem() {
    if (!selectedExerciseId) return
    const ex = exercises.find((e) => e.id === selectedExerciseId)
    if (!ex) return
    setItems((prev) => [
      ...prev,
      {
        exerciseId: ex.id,
        exerciseName: ex.name,
        sets: 3,
        reps: '10',
        loadKg: null,
        restSeconds: 60,
        notes: '',
      },
    ])
    setSelectedExerciseId('')
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function moveUp(idx: number) {
    if (idx === 0) return
    setItems((prev) => {
      const out = [...prev]
      ;[out[idx - 1], out[idx]] = [out[idx]!, out[idx - 1]!]
      return out
    })
  }

  function moveDown(idx: number) {
    setItems((prev) => {
      if (idx >= prev.length - 1) return prev
      const out = [...prev]
      ;[out[idx + 1], out[idx]] = [out[idx]!, out[idx + 1]!]
      return out
    })
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (items.length === 0) {
      setError('Adicione ao menos 1 exercício')
      return
    }
    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') ?? '').trim()
    if (!name) {
      setError('Nome é obrigatório')
      return
    }

    startTransition(async () => {
      const result = await createWorkout({
        name,
        description: String(fd.get('description') ?? '').trim() || undefined,
        goal: String(fd.get('goal') ?? '').trim() || undefined,
        estimatedDurationMin: Number(fd.get('estimatedDurationMin')) || undefined,
        items: items.map((it, idx) => ({
          exerciseId: it.exerciseId,
          order: idx,
          sets: it.sets,
          reps: it.reps,
          loadKg: it.loadKg ?? undefined,
          restSeconds: it.restSeconds,
          notes: it.notes || undefined,
        })),
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push(`/app/treinos/${result.data.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
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

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Identificação
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Nome *</span>
            <input
              name="name"
              type="text"
              required
              placeholder="Treino A — Peito e Tríceps"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Descrição</span>
            <textarea
              name="description"
              rows={2}
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Objetivo</span>
            <input
              name="goal"
              type="text"
              placeholder="hipertrofia, resistência, emagrecimento..."
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Duração estimada (min)</span>
            <input
              name="estimatedDurationMin"
              type="number"
              min="1"
              max="360"
              placeholder="45"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Exercícios ({items.length})
          </h2>
        </header>

        <div className="flex gap-2 items-end">
          <label className="space-y-1 text-sm flex-1">
            <span className="block font-medium">Adicionar exercício</span>
            <select
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            >
              <option value="">(escolha)</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} · {ex.level} {ex.isGlobal ? '· Global' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addItem}
            disabled={!selectedExerciseId}
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 text-sm hover:bg-[color:var(--ev-surface)] disabled:opacity-50"
          >
            +
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Nenhum exercício adicionado.
          </p>
        ) : (
          <ol className="space-y-3">
            {items.map((it, idx) => (
              <li
                key={`${it.exerciseId}-${idx}`}
                className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 space-y-2"
              >
                <header className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">
                    {idx + 1}. {it.exerciseName}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      className="rounded p-1 hover:bg-[color:var(--ev-surface)] disabled:opacity-30"
                      aria-label="Mover pra cima"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(idx)}
                      disabled={idx === items.length - 1}
                      className="rounded p-1 hover:bg-[color:var(--ev-surface)] disabled:opacity-30"
                      aria-label="Mover pra baixo"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="rounded p-1 hover:bg-[color:var(--ev-surface)]"
                      aria-label="Remover"
                      style={{ color: 'var(--ev-danger, #ef4444)' }}
                    >
                      ✕
                    </button>
                  </div>
                </header>
                <div className="grid grid-cols-4 gap-2">
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Séries</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={it.sets}
                      onChange={(e) =>
                        updateItem(idx, { sets: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Reps</span>
                    <input
                      type="text"
                      value={it.reps}
                      onChange={(e) => updateItem(idx, { reps: e.target.value })}
                      placeholder="10 ou 8-12"
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Carga (kg)</span>
                    <input
                      type="number"
                      min="0"
                      max="999"
                      step="0.5"
                      value={it.loadKg ?? ''}
                      onChange={(e) =>
                        updateItem(idx, {
                          loadKg: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Descanso (s)</span>
                    <input
                      type="number"
                      min="0"
                      max="3600"
                      value={it.restSeconds}
                      onChange={(e) =>
                        updateItem(idx, { restSeconds: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    />
                  </label>
                </div>
                <label className="space-y-0.5 text-xs block">
                  <span className="block font-medium">Notas</span>
                  <input
                    type="text"
                    value={it.notes}
                    onChange={(e) => updateItem(idx, { notes: e.target.value })}
                    placeholder="Ex: foco na fase excêntrica"
                    className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                  />
                </label>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending || items.length === 0}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar workout'}
        </button>
      </div>
    </form>
  )
}
