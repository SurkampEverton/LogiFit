'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { importInBodyCsv } from '../actions'

interface ImportResult {
  inserted: number
  validReadings: number
  invalidReadings: number
  parseErrors: Array<{ line: number; reason: string }>
}

export function ImportCsvForm() {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (content.trim().length < 10) {
      setErr('Cole o conteúdo do CSV (pelo menos cabeçalho + 1 linha).')
      return
    }
    setErr(null)
    setResult(null)
    startTransition(async () => {
      try {
        const r = (await importInBodyCsv({ content })) as
          | (ImportResult & { ok: true })
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha no import')
          return
        }
        const okResult = r as ImportResult & { ok: true }
        setResult(okResult)
        router.refresh()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <label className="ev-portal-label" htmlFor="csv">
        Conteúdo do CSV
      </label>
      <textarea
        id="csv"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={12}
        placeholder={`Date,Time,Weight,BodyFatPct,MuscleMass\n2026-05-18,08:00:00,80.5,22.3,33.2`}
        className="ev-portal-textarea"
        style={{ fontFamily: 'monospace', fontSize: 'var(--ev-text-xs)' }}
      />

      <button type="submit" disabled={pending} className="ev-portal-button">
        {pending ? 'Importando...' : 'Importar'}
      </button>

      {err ? <div className="ev-portal-callout ev-portal-callout--danger">{err}</div> : null}

      {result ? (
        <div className="ev-portal-callout ev-portal-callout--success">
          <h3 className="ev-portal-h3">Import concluído</h3>
          <p>
            ✓ {result.inserted} leituras inseridas ({result.validReadings} válidas total — o resto
            era duplicata)
          </p>
          {result.invalidReadings > 0 ? (
            <p style={{ color: 'var(--ev-warning-hover)' }}>
              ⚠ {result.invalidReadings} leituras ignoradas (fora da faixa fisiológica)
            </p>
          ) : null}
          {result.parseErrors.length > 0 ? (
            <details>
              <summary>{result.parseErrors.length} erros de parse</summary>
              <ul style={{ fontSize: 'var(--ev-text-xs)', fontFamily: 'monospace' }}>
                {result.parseErrors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    Linha {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
