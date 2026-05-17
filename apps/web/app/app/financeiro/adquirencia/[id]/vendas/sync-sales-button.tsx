'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { syncAcquirerSales } from '../../actions'

export function SyncSalesButton({ connectionId }: { connectionId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })()
  const [from, setFrom] = useState(sevenDaysAgo)
  const [to, setTo] = useState(today)

  function sync() {
    setMessage(null)
    startTransition(async () => {
      const r = await syncAcquirerSales({ connectionId, from, to })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage(
        `✓ ${r.data.imported} importadas · ${r.data.skipped} duplicadas (idempotente)`,
      )
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="date"
        className="ev-input"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        style={{ width: 140 }}
      />
      <span style={{ color: 'var(--ev-muted)' }}>→</span>
      <input
        type="date"
        className="ev-input"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        style={{ width: 140 }}
      />
      <button onClick={sync} className="ev-btn ev-btn-primary" disabled={pending}>
        {pending ? 'Sincronizando...' : 'Sincronizar agora'}
      </button>
      {message && (
        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-success, #16a34a)' }}>
          {message}
        </span>
      )}
    </div>
  )
}
