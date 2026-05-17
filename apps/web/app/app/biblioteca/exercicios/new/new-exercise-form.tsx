'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createExercise } from '../../../treinos/actions'

export function NewExerciseForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') ?? '').trim()
    const muscleGroupsRaw = String(fd.get('muscleGroups') ?? '').trim()
    const muscleGroups = muscleGroupsRaw
      ? muscleGroupsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : []
    const metValue = Number(fd.get('metValue'))
    const level = String(fd.get('level')) as 'iniciante' | 'intermediario' | 'avancado'

    if (!name || !metValue) {
      setError('Nome e MET são obrigatórios')
      return
    }

    startTransition(async () => {
      const result = await createExercise({
        name,
        description: String(fd.get('description') ?? '').trim() || undefined,
        muscleGroups,
        equipment: String(fd.get('equipment') ?? '').trim() || undefined,
        level,
        metValue,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/biblioteca/exercicios')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-[color:var(--ev-border)] p-6">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Nome *</span>
          <input
            name="name"
            type="text"
            required
            placeholder="Agachamento livre"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Descrição</span>
          <textarea
            name="description"
            rows={3}
            placeholder="Postura ereta, descida controlada, joelhos alinhados..."
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Nível *</span>
          <select
            name="level"
            defaultValue="iniciante"
            required
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="iniciante">Iniciante</option>
            <option value="intermediario">Intermediário</option>
            <option value="avancado">Avançado</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">MET Compendium *</span>
          <input
            name="metValue"
            type="number"
            step="0.1"
            min="0.1"
            max="20"
            required
            placeholder="5.0"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Equipamento</span>
          <input
            name="equipment"
            type="text"
            placeholder="Barra, halteres, máquina..."
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Grupos musculares</span>
          <input
            name="muscleGroups"
            type="text"
            placeholder="quadriceps, gluteo, posterior"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
      </div>

      <p className="text-xs text-[color:var(--ev-text-muted)]">
        Grupos musculares separados por vírgula. MET via Compendium of Physical
        Activities 2024 — guia: musculação leve 3-4, intensa 5-6, HIIT 8+.
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar exercício'}
        </button>
      </div>
    </form>
  )
}
