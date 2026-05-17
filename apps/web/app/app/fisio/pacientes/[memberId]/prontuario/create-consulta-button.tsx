'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createConsulta } from '../../../consultas/actions'

const KINDS = [
  { key: 'fisio', label: '🩹 Fisio (lacre autenticado)' },
  { key: 'medico', label: '🩺 Médico (ICP-Brasil A3)' },
  { key: 'nutri', label: '🥗 Nutri (lacre autenticado)' },
  { key: 'personal', label: '💪 Personal (lacre)' },
  { key: 'enfermeiro', label: '🩻 Enfermeiro (lacre)' },
  { key: 'custom', label: '📝 Custom (fallback fisio)' },
] as const

export function CreateConsultaButton({ memberId }: { memberId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('fisio')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await createConsulta({
        memberId,
        kind,
        content: { queixa: '', avaliacao: '', conduta: '' },
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push(`/app/fisio/consultas/${r.data.id}`)
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ev-btn ev-btn-primary">
        + Nova consulta
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select
        className="ev-input"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        {KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      <button onClick={submit} className="ev-btn ev-btn-primary" disabled={pending}>
        {pending ? 'Criando...' : 'Criar'}
      </button>
      <button onClick={() => setOpen(false)} className="ev-btn ev-btn-ghost">
        Cancelar
      </button>
      {error && (
        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger)' }}>{error}</span>
      )}
    </div>
  )
}
