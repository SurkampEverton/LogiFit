'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { addAttachmentMetadata } from '../actions'

const KINDS = [
  { key: 'exame_imagem', label: '🩻 Exame imagem (raio-X / RM / US)' },
  { key: 'video_execucao', label: '🎥 Vídeo execução' },
  { key: 'documento', label: '📄 Documento (laudo / receita)' },
  { key: 'foto_postural', label: '📷 Foto postural' },
  { key: 'audio_anamnese', label: '🎙 Áudio anamnese' },
] as const

type Kind = (typeof KINDS)[number]['key']

/**
 * Calcula sha256 hex do arquivo no browser (Web Crypto). Determinístico.
 */
async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function AddAttachmentForm({ evolucaoId }: { evolucaoId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<Kind>('exame_imagem')
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    if (!file) return setError('Selecione um arquivo')

    startTransition(async () => {
      try {
        const contentHash = await hashFile(file)
        // MVP: registra metadata como "clean" (upload real + scan vem Sprint 21b).
        // Em Sprint 21b: API Route faz multipart upload + scanUpload + addAttachmentMetadata
        // com pendingScan=true; markAttachmentScanResult finaliza.
        const r = await addAttachmentMetadata({
          evolucaoId,
          kind,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          contentHash,
          caption: caption.trim() || null,
          pendingScan: false,
        })
        if (!r.ok) {
          setError(r.error.message)
          return
        }
        setMessage(`✓ Anexo registrado (metadata). Upload real chega no Sprint 21b.`)
        setFile(null)
        setCaption('')
        router.refresh()
      } catch (err) {
        setError(`Erro: ${(err as Error).message}`)
      }
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
        marginBottom: 'var(--ev-space-md)',
      }}
    >
      <label className="ev-stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
        <strong>Adicionar anexo (MVP — metadata only)</strong>
        <small style={{ color: 'var(--ev-muted)' }}>
          Sprint 21b implementa upload real ao MinIO via API Route com scanUpload obrigatório.
        </small>
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Categoria</span>
        <select
          className="ev-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Arquivo</span>
        <input
          type="file"
          className="ev-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className="ev-stack" style={{ gap: 4, gridColumn: '1 / -1' }}>
        <span>Caption (opcional)</span>
        <input
          className="ev-input"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Descrição breve do anexo"
        />
      </label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending || !file}>
          {pending ? 'Calculando hash + registrando...' : '+ Registrar metadata'}
        </button>
        {error && (
          <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger)' }}>
            {error}
          </span>
        )}
        {message && (
          <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-success, #16a34a)' }}>
            {message}
          </span>
        )}
      </div>
    </form>
  )
}
