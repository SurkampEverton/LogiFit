'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { prescribeWorkout } from '../../../treinos/actions'

interface WorkoutOption {
  id: string
  name: string
  goal: string | null
  version: number
}

interface Props {
  memberId: string
  workouts: WorkoutOption[]
}

export function PrescribeWorkoutForm({ memberId, workouts }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const fd = new FormData(e.currentTarget)
    const workoutId = String(fd.get('workoutId'))
    const startsAt = String(fd.get('startsAt'))
    const endsAt = String(fd.get('endsAt') ?? '').trim()
    const notes = String(fd.get('notes') ?? '').trim()

    if (!workoutId || !startsAt) {
      setError('Workout e data de início obrigatórios')
      return
    }

    startTransition(async () => {
      const result = await prescribeWorkout({
        memberId,
        workoutId,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        notes: notes || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSuccess(true)
      router.refresh()
    })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
      {success && (
        <div
          role="status"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-success, #22c55e)',
            color: 'var(--ev-success, #22c55e)',
          }}
        >
          ✓ Prescrição criada
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Workout *</span>
          <select
            name="workoutId"
            required
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">(escolha)</option>
            {workouts.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} {w.goal ? `· ${w.goal}` : ''} (v{w.version})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Início *</span>
          <input
            name="startsAt"
            type="date"
            required
            defaultValue={today}
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Fim (opcional)</span>
          <input
            name="endsAt"
            type="date"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Observações</span>
          <textarea
            name="notes"
            rows={2}
            placeholder="Adaptações, restrições..."
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Prescrevendo...' : 'Prescrever workout'}
        </button>
      </div>
    </form>
  )
}
