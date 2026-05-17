'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { closeIntervention } from '../../actions'

const OUTCOMES = [
  { key: 'success', label: '✓ Sucesso (ativo)' },
  { key: 'partial', label: '~ Parcial' },
  { key: 'failed', label: '✗ Falhou' },
  { key: 'member_canceled_anyway', label: '⚠ Cancelou' },
] as const

export function CloseInterventionForm({ interventionId }: { interventionId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['key']>('success')
  const [notes, setNotes] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await closeIntervention({
        interventionId,
        outcome,
        outcomeNotes: notes.trim() || null,
      })
      if (r.ok) {
        setOpen(false)
        setNotes('')
        router.refresh()
      }
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ev-btn ev-btn-ghost">
        Encerrar
      </button>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select
        className="ev-input"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        style={{ minWidth: 180 }}
      >
        {OUTCOMES.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        className="ev-input"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas..."
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          OK
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ev-btn ev-btn-ghost"
          disabled={pending}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
