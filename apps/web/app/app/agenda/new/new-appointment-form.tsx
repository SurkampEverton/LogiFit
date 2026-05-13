'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createAppointment } from '../actions'

interface ResourceOption {
  id: string
  name: string
  kind: string
}

interface MemberOption {
  id: string
  name: string
}

const KIND_LABEL: Record<string, string> = {
  instrutor: 'Instrutor',
  sala: 'Sala',
  equipamento: 'Equipamento',
}

/**
 * Helper: combina date (YYYY-MM-DD) + time (HH:MM) em ISO datetime local
 * → converte para UTC ISO string (Server Action espera ISO 8601 com Z/offset).
 */
function combineToIso(date: string, time: string): string {
  if (!date || !time) return ''
  const d = new Date(`${date}T${time}:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

export function NewAppointmentForm({
  availableResources,
  availableMembers,
}: {
  availableResources: ResourceOption[]
  availableMembers: MemberOption[]
}) {
  const router = useRouter()
  const [resourceId, setResourceId] = useState(availableResources[0]?.id ?? '')
  const [memberId, setMemberId] = useState('')

  // Default: hoje + próxima hora cheia
  const now = new Date()
  const defaultDate = now.toISOString().slice(0, 10)
  const nextHour = new Date(now)
  nextHour.setHours(now.getHours() + 1, 0, 0, 0)
  const defaultStartTime = nextHour.toTimeString().slice(0, 5)
  const endHour = new Date(nextHour)
  endHour.setHours(nextHour.getHours() + 1)
  const defaultEndTime = endHour.toTimeString().slice(0, 5)

  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState(defaultStartTime)
  const [endTime, setEndTime] = useState(defaultEndTime)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const startsAt = combineToIso(date, startTime)
    const endsAt = combineToIso(date, endTime)
    if (!startsAt || !endsAt) {
      setError('Data ou horário inválido')
      setSubmitting(false)
      return
    }

    const result = await createAppointment({
      resourceId,
      memberId,
      startsAt,
      endsAt,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push('/app/agenda')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="resourceId" className="block text-sm font-medium">
          Recurso <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="resourceId"
          required
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Selecione…</option>
          {availableResources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {KIND_LABEL[r.kind] ?? r.kind}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="memberId" className="block text-sm font-medium">
          Member <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="memberId"
          required
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Selecione…</option>
          {availableMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="date" className="block text-sm font-medium">
          Data <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <input
          id="date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="startTime" className="block text-sm font-medium">
            Início <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="startTime"
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="endTime" className="block text-sm font-medium">
            Fim <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="endTime"
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] p-3 text-sm text-[color:var(--ev-danger)]"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !resourceId || !memberId || !date || !startTime || !endTime}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Agendando…' : 'Agendar'}
        </button>
        <a
          href="/app/agenda"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
