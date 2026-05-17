'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateEvolucao } from '../actions'

interface SoapState {
  subjetivo: string
  objetivo: string
  avaliacao: string
  plano: string
}

export function EvolucaoEditor({
  evolucaoId,
  soap,
  freeText,
  readonly,
}: {
  evolucaoId: string
  soap: SoapState
  freeText: string
  readonly: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [data, setData] = useState<SoapState>(soap)
  const [text, setText] = useState(freeText)
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    startTransition(async () => {
      const r = await updateEvolucao({
        evolucaoId,
        soap: {
          subjetivo: data.subjetivo.trim() || null,
          objetivo: data.objetivo.trim() || null,
          avaliacao: data.avaliacao.trim() || null,
          plano: data.plano.trim() || null,
        },
        freeText: text.trim() || null,
      })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage('✓ Salvo')
      router.refresh()
    })
  }

  return (
    <section className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <h2>SOAP</h2>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>S</strong>ubjetivo
        </span>
        <textarea
          className="ev-input"
          value={data.subjetivo}
          onChange={(e) => setData((d) => ({ ...d, subjetivo: e.target.value }))}
          rows={2}
          readOnly={readonly}
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>O</strong>bjetivo
        </span>
        <textarea
          className="ev-input"
          value={data.objetivo}
          onChange={(e) => setData((d) => ({ ...d, objetivo: e.target.value }))}
          rows={2}
          readOnly={readonly}
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>A</strong>valiação
        </span>
        <textarea
          className="ev-input"
          value={data.avaliacao}
          onChange={(e) => setData((d) => ({ ...d, avaliacao: e.target.value }))}
          rows={2}
          readOnly={readonly}
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>P</strong>lano
        </span>
        <textarea
          className="ev-input"
          value={data.plano}
          onChange={(e) => setData((d) => ({ ...d, plano: e.target.value }))}
          rows={2}
          readOnly={readonly}
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Texto livre</span>
        <textarea
          className="ev-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          readOnly={readonly}
        />
      </label>

      {!readonly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} className="ev-btn ev-btn-primary" disabled={pending}>
            {pending ? 'Salvando...' : 'Salvar rascunho'}
          </button>
          {message && (
            <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              {message}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
