'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { assignIntervention } from '../../actions'

const ACTIONS = [
  { key: 'phone_call', label: '📞 Ligação' },
  { key: 'whatsapp_message', label: '💬 WhatsApp' },
  { key: 'free_pass', label: '🎫 Passe livre (1 visita grátis)' },
  { key: 'discount_offer', label: '💸 Oferta de desconto' },
  { key: 'in_person_visit', label: '🚶 Visita presencial' },
  { key: 'manual', label: '✍️ Manual / outro' },
] as const

export function AssignInterventionForm({
  predictionId,
  users,
}: {
  predictionId: string
  users: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [action, setAction] = useState<(typeof ACTIONS)[number]['key']>('phone_call')
  const [assignedTo, setAssignedTo] = useState(users[0]?.id ?? '')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (!assignedTo) return setMessage('Selecione operador')
    startTransition(async () => {
      const r = await assignIntervention({
        predictionId,
        assignedToUserId: assignedTo,
        action,
        notes: notes.trim() || null,
      })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage('✓ Intervenção atribuída')
      setNotes('')
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--ev-space-md)',
      }}
    >
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Ação</span>
        <select
          className="ev-input"
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          {ACTIONS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Atribuir a</span>
        <select
          className="ev-input"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ev-stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
        <span>Notas (contexto pra atendente)</span>
        <textarea
          className="ev-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Ex: Member sumiu há 3 semanas, mencionou problema financeiro na última ligação"
        />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Atribuindo...' : 'Atribuir intervenção'}
        </button>
        {message && (
          <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>{message}</span>
        )}
      </div>
    </form>
  )
}
