'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createCorrectionNote } from '../actions'

export function CorrectionNoteForm({ consultaId }: { consultaId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await createCorrectionNote({ consultaId, body, reason })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setOpen(false)
      setBody('')
      setReason('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ev-btn ev-btn-ghost">
        + Nota corretiva
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
      <p style={{ marginTop: 0, fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
        Nota corretiva é append-only — entra na audit chain (regra 39) e fica anexada
        ao prontuário sem alterar o conteúdo original assinado.
      </p>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Motivo</span>
        <input
          className="ev-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Erro de digitação CID / atualização de conduta / ..."
          required
        />
      </label>
      <label className="ev-stack" style={{ gap: 4, marginTop: 8 }}>
        <span>Corpo da nota</span>
        <textarea
          className="ev-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
        />
      </label>
      {error && (
        <div className="ev-banner ev-banner-danger" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando...' : 'Anexar nota'}
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
