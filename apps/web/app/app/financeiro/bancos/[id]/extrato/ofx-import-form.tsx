'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { importOfx } from '../../actions'

export function OfxImportForm({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(
    null,
  )
  const [expanded, setExpanded] = useState(false)

  function handleFile(file: File) {
    setError(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = String(e.target?.result ?? '')
      if (content.length < 20) {
        setError('Arquivo vazio ou inválido')
        return
      }
      startTransition(async () => {
        const r = await importOfx({ bankAccountId, ofxContent: content })
        if (!r.ok) {
          setError(r.error.message)
          return
        }
        setResult(r.data)
        router.refresh()
      })
    }
    reader.onerror = () => setError('Falha ao ler arquivo')
    reader.readAsText(file)
  }

  return (
    <section
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-sm)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-sm)' }}>
        <h3 style={{ margin: 0 }}>Importar extrato OFX</h3>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ev-btn ev-btn-ghost"
          style={{ marginLeft: 'auto' }}
        >
          {expanded ? 'Recolher' : 'Expandir'}
        </button>
      </header>

      {expanded && (
        <>
          <p style={{ margin: 0, fontSize: 'var(--ev-font-sm)', color: 'var(--ev-muted)' }}>
            Exporte o extrato no formato OFX pelo internet banking (Bradesco/Itaú/Santander
            disponibilizam). Transações duplicadas (por FITID) são ignoradas automaticamente.
          </p>
          <input
            type="file"
            accept=".ofx,.qfx,.txt,application/x-ofx"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
            className="ev-input"
          />
          {pending && <div style={{ color: 'var(--ev-muted)' }}>Processando…</div>}
          {error && (
            <div className="ev-alert ev-alert-danger" role="alert">
              {error}
            </div>
          )}
          {result && (
            <div
              className="ev-alert ev-alert-success"
              role="status"
              style={{ padding: 'var(--ev-space-sm)' }}
            >
              ✓ {result.imported} importadas
              {result.skipped > 0 && ` · ${result.skipped} já existiam (FITID duplicado)`}
              {result.total > result.imported + result.skipped &&
                ` · ${result.total - result.imported - result.skipped} ignoradas (dados incompletos)`}
            </div>
          )}
        </>
      )}
    </section>
  )
}
