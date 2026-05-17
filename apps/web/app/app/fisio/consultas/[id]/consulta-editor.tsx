'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { linkCid, linkCif, updateConsultaContent } from '../actions'

interface SoapContent {
  queixa: string
  avaliacao: string
  conduta: string
  observacoes: string
}

export function ConsultaEditor({
  consultaId,
  content,
  readonly,
}: {
  consultaId: string
  content: SoapContent
  readonly: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [data, setData] = useState<SoapContent>(content)
  const [message, setMessage] = useState<string | null>(null)

  // CID add
  const [newCidCode, setNewCidCode] = useState('')
  const [newCidKind, setNewCidKind] = useState<'principal' | 'secundario'>('principal')
  const [newCidNotes, setNewCidNotes] = useState('')

  // CIF add
  const [newCifCode, setNewCifCode] = useState('')
  const [newCifQualifier, setNewCifQualifier] = useState(2)
  const [newCifNotes, setNewCifNotes] = useState('')

  function save() {
    setMessage(null)
    startTransition(async () => {
      const r = await updateConsultaContent({
        consultaId,
        content: data as unknown as Record<string, unknown>,
      })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage('✓ Salvo')
      router.refresh()
    })
  }

  function addCid() {
    setMessage(null)
    if (!newCidCode.trim()) return setMessage('CID obrigatório')
    startTransition(async () => {
      const r = await linkCid({
        consultaId,
        cidCode: newCidCode.trim().toUpperCase(),
        kind: newCidKind,
        notes: newCidNotes.trim() || null,
      })
      if (!r.ok) {
        setMessage(`Erro CID: ${r.error.message}`)
        return
      }
      setNewCidCode('')
      setNewCidNotes('')
      setMessage('✓ CID vinculado')
      router.refresh()
    })
  }

  function addCif() {
    setMessage(null)
    if (!newCifCode.trim()) return setMessage('CIF obrigatório')
    startTransition(async () => {
      const r = await linkCif({
        consultaId,
        cifCode: newCifCode.trim().toLowerCase(),
        qualifier: newCifQualifier,
        notes: newCifNotes.trim() || null,
      })
      if (!r.ok) {
        setMessage(`Erro CIF: ${r.error.message}`)
        return
      }
      setNewCifCode('')
      setNewCifNotes('')
      setMessage('✓ CIF vinculado')
      router.refresh()
    })
  }

  return (
    <section className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <h2>SOAP</h2>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>S</strong>ubjetivo / Queixa
        </span>
        <textarea
          className="ev-input"
          value={data.queixa}
          onChange={(e) => setData((d) => ({ ...d, queixa: e.target.value }))}
          rows={3}
          readOnly={readonly}
          placeholder="O que o paciente relata..."
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>O/A</strong> — Objetivo + Avaliação
        </span>
        <textarea
          className="ev-input"
          value={data.avaliacao}
          onChange={(e) => setData((d) => ({ ...d, avaliacao: e.target.value }))}
          rows={4}
          readOnly={readonly}
          placeholder="Exame físico, testes, escalas (EVA, ASIA, etc)..."
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>
          <strong>P</strong>lano / Conduta
        </span>
        <textarea
          className="ev-input"
          value={data.conduta}
          onChange={(e) => setData((d) => ({ ...d, conduta: e.target.value }))}
          rows={3}
          readOnly={readonly}
          placeholder="Conduta terapêutica, retorno, orientações..."
        />
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Observações</span>
        <textarea
          className="ev-input"
          value={data.observacoes}
          onChange={(e) => setData((d) => ({ ...d, observacoes: e.target.value }))}
          rows={2}
          readOnly={readonly}
        />
      </label>

      {!readonly && (
        <>
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

          <h3 style={{ marginTop: 'var(--ev-space-md)' }}>Adicionar CID-11</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="ev-stack" style={{ gap: 4, minWidth: 120 }}>
              <span>Código</span>
              <input
                className="ev-input"
                value={newCidCode}
                onChange={(e) => setNewCidCode(e.target.value)}
                placeholder="MG30.0"
              />
            </label>
            <label className="ev-stack" style={{ gap: 4 }}>
              <span>Tipo</span>
              <select
                className="ev-input"
                value={newCidKind}
                onChange={(e) => setNewCidKind(e.target.value as typeof newCidKind)}
              >
                <option value="principal">Principal</option>
                <option value="secundario">Secundário</option>
              </select>
            </label>
            <label className="ev-stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span>Notas</span>
              <input
                className="ev-input"
                value={newCidNotes}
                onChange={(e) => setNewCidNotes(e.target.value)}
              />
            </label>
            <button onClick={addCid} className="ev-btn ev-btn-ghost" disabled={pending}>
              + Vincular
            </button>
          </div>

          <h3>Adicionar CIF</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="ev-stack" style={{ gap: 4, minWidth: 120 }}>
              <span>Código</span>
              <input
                className="ev-input"
                value={newCifCode}
                onChange={(e) => setNewCifCode(e.target.value)}
                placeholder="b280"
              />
            </label>
            <label className="ev-stack" style={{ gap: 4, minWidth: 90 }}>
              <span>Qualifier (0-4)</span>
              <input
                className="ev-input"
                type="number"
                min={0}
                max={4}
                value={newCifQualifier}
                onChange={(e) => setNewCifQualifier(Number(e.target.value))}
              />
            </label>
            <label className="ev-stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span>Notas</span>
              <input
                className="ev-input"
                value={newCifNotes}
                onChange={(e) => setNewCifNotes(e.target.value)}
              />
            </label>
            <button onClick={addCif} className="ev-btn ev-btn-ghost" disabled={pending}>
              + Vincular
            </button>
          </div>
        </>
      )}
    </section>
  )
}
