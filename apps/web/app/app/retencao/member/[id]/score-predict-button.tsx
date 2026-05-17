'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { scorePredict } from '../../actions'

export function ScorePredictButton({ memberId }: { memberId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function run(force: boolean) {
    setMessage(null)
    startTransition(async () => {
      const r = await scorePredict({ memberId, force })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage(r.data.cached ? '✓ Cache hit — predição reutilizada' : '✓ Nova predição computada')
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button onClick={() => run(false)} className="ev-btn ev-btn-primary" disabled={pending}>
        {pending ? 'Calculando...' : 'Calcular agora'}
      </button>
      <button onClick={() => run(true)} className="ev-btn ev-btn-ghost" disabled={pending} title="Ignora cache">
        ↻ Forçar
      </button>
      {message && (
        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>{message}</span>
      )}
    </div>
  )
}
