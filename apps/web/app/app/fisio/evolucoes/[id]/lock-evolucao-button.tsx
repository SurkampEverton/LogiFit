'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { lockEvolucao } from '../actions'

export function LockEvolucaoButton({ evolucaoId }: { evolucaoId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [method, setMethod] = useState<'authenticated' | 'icp_brasil'>('authenticated')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await lockEvolucao({
        evolucaoId,
        signMethod: method,
        signatureProvider: method === 'icp_brasil' ? 'placeholder-icp' : null,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="ev-stack" style={{ gap: 4 }}>
        <span>Método</span>
        <select
          className="ev-input"
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          <option value="authenticated">🔒 Lacre autenticado (default fisio)</option>
          <option value="icp_brasil">✍️ ICP-Brasil (opcional)</option>
        </select>
      </label>
      <button onClick={submit} className="ev-btn ev-btn-primary" disabled={pending}>
        {pending ? 'Fechando...' : '🔒 Fechar evolução'}
      </button>
      {error && (
        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-danger)' }}>{error}</span>
      )}
    </div>
  )
}
