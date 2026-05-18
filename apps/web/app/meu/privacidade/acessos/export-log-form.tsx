'use client'

/**
 * Form simplificado: solicita export CSV/PDF dos últimos 90d via Server Action
 * `exportCrossTenantAccessLog`. Mostra link de download em `/api/meu/privacidade/export/[id]`
 * (TTL 7d) quando resposta volta.
 */
import { useState, useTransition } from 'react'
import { exportCrossTenantAccessLog } from '../../actions'

export function ExportLogForm() {
  const [pending, startTransition] = useTransition()
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setDownloadUrl(null)
    startTransition(async () => {
      try {
        const now = new Date()
        const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
        const endDate = now.toISOString()
        const result = (await exportCrossTenantAccessLog({ startDate, endDate, format })) as
          | { ok: true; exportId: string; downloadUrl: string }
          | { ok: false; error?: { message?: string } }
        if (!result.ok) {
          setErr(result.error?.message ?? 'Falha ao gerar export')
          return
        }
        setDownloadUrl(result.downloadUrl)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="ev-portal-form">
      <div className="ev-portal-h3">Exportar últimos 90 dias</div>
      <label className="ev-portal-label" htmlFor="export-format">
        Formato
      </label>
      <select
        id="export-format"
        className="ev-portal-select"
        value={format}
        onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf')}
      >
        <option value="csv">CSV (planilha)</option>
        <option value="pdf">PDF</option>
      </select>
      <button type="submit" disabled={pending} className="ev-portal-button">
        {pending ? 'Gerando...' : 'Gerar export'}
      </button>
      {downloadUrl ? (
        <div className="ev-portal-callout ev-portal-callout--success">
          <p>Export gerado. O link expira em 7 dias.</p>
          <a href={downloadUrl} className="ev-portal-button" download>
            Baixar arquivo
          </a>
        </div>
      ) : null}
      {err ? (
        <div className="ev-portal-callout ev-portal-callout--danger">
          <p>{err}</p>
        </div>
      ) : null}
    </form>
  )
}
