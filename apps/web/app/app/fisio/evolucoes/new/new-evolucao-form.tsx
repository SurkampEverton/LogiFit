'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createEvolucao } from '../actions'

export function NewEvolucaoForm({
  memberId,
  appointmentId,
}: {
  memberId: string
  appointmentId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [subjetivo, setSubjetivo] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [avaliacao, setAvaliacao] = useState('')
  const [plano, setPlano] = useState('')
  const [freeText, setFreeText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const r = await createEvolucao({
        memberId,
        appointmentId,
        soap: {
          subjetivo: subjetivo.trim() || null,
          objetivo: objetivo.trim() || null,
          avaliacao: avaliacao.trim() || null,
          plano: plano.trim() || null,
        },
        freeText: freeText.trim() || null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push(`/app/fisio/evolucoes/${r.data.id}`)
    })
  }

  return (
    <form onSubmit={submit} className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      {appointmentId && (
        <div className="ev-banner ev-banner-info">
          Vinculada ao agendamento <code>{appointmentId.slice(0, 8)}…</code>
        </div>
      )}

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>S</strong>ubjetivo (relato do paciente)
        </span>
        <textarea
          className="ev-input"
          value={subjetivo}
          onChange={(e) => setSubjetivo(e.target.value)}
          rows={2}
          autoFocus
          placeholder="Ex: dor lombar diminuiu, conseguiu dormir melhor"
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>O</strong>bjetivo (achado clínico)
        </span>
        <textarea
          className="ev-input"
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          rows={2}
          placeholder="Ex: ADM lombar 80%, força 4/5 paravertebrais"
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>A</strong>valiação (interpretação)
        </span>
        <textarea
          className="ev-input"
          value={avaliacao}
          onChange={(e) => setAvaliacao(e.target.value)}
          rows={2}
          placeholder="Ex: evolução positiva, manter conduta atual"
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>P</strong>lano (conduta)
        </span>
        <textarea
          className="ev-input"
          value={plano}
          onChange={(e) => setPlano(e.target.value)}
          rows={2}
          placeholder="Ex: 8 sessões semanais; HEP 3×/semana isométricos paravertebrais"
        />
      </label>

      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Texto livre (opcional)</span>
        <textarea
          className="ev-input"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={2}
          placeholder="Anotações fora do SOAP..."
        />
      </label>

      {error && <div className="ev-banner ev-banner-danger">{error}</div>}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Criando...' : 'Criar rascunho'}
        </button>
      </div>
    </form>
  )
}
