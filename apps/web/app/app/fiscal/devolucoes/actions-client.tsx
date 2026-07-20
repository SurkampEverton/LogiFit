'use client'

/**
 * Ação de emitir NF-e de devolução — Sprint 17b (ADR 0104).
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { emitNfeReturn } from '../actions'

export function ReturnActions({ nfeReturnId }: { nfeReturnId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmit() {
    setPending(true)
    setError(null)
    try {
      const r = await emitNfeReturn({ nfeReturnId })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      router.push(`/app/fiscal/${r.data.id}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao emitir devolução')
      setPending(false)
    }
  }

  return (
    <span className="ev-row" style={{ gap: 'var(--ev-space-1)' }}>
      <button
        type="button"
        className="ev-btn ev-btn-primary ev-btn-sm"
        disabled={pending}
        onClick={() => void handleEmit()}
      >
        {pending ? 'Emitindo…' : '📄 Emitir NF-e'}
      </button>
      {error && (
        <span
          className="text-xs"
          role="alert"
          style={{ color: 'var(--ev-danger)', maxWidth: '18rem', display: 'inline-block' }}
        >
          {error}
        </span>
      )}
    </span>
  )
}
