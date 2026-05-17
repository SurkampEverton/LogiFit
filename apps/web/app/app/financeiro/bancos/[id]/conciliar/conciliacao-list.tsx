'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmMatch, suggestMatchesAction } from '../../actions'

interface Transaction {
  id: string
  postedAt: string
  amountCents: number
  description: string
}

interface Suggestion {
  candidate: {
    id: string
    kind: 'ap' | 'ar'
    amountCents: number
    dueDate: string
    description: string | null
    supplierName?: string | null
    payerName?: string | null
  }
  score: number
  reasons: string[]
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function ConciliacaoList({ transactions }: { transactions: Transaction[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-md)' }}>
      {transactions.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ margin: 0, color: 'var(--ev-muted)' }}>
            Nenhuma transação pendente. Todas conciliadas ✓
          </p>
        </div>
      ) : (
        transactions.map((tx) => <ConciliacaoItem key={tx.id} tx={tx} />)
      )}
    </div>
  )
}

function ConciliacaoItem({ tx }: { tx: Transaction }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [loadedSuggestions, setLoadedSuggestions] = useState(false)
  const isOut = tx.amountCents < 0

  function loadSuggestions() {
    setError(null)
    startTransition(async () => {
      const r = await suggestMatchesAction({ bankTxId: tx.id, maxResults: 3 })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setSuggestions(r.data.suggestions as Suggestion[])
      setLoadedSuggestions(true)
    })
  }

  function confirmSugestion(target: 'ap' | 'ar', targetId: string) {
    setError(null)
    startTransition(async () => {
      const r = await confirmMatch({ bankTxId: tx.id, target, targetId })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          marginBottom: 'var(--ev-space-sm)',
        }}
      >
        <strong style={{ fontSize: 'var(--ev-font-md)' }}>{tx.description}</strong>
        <span style={{ color: 'var(--ev-muted)', fontSize: 'var(--ev-font-xs)' }}>
          {new Date(tx.postedAt).toLocaleDateString('pt-BR')}
        </span>
        <span style={{ flex: 1 }} />
        <strong
          style={{
            color: isOut ? 'var(--ev-danger, #dc2626)' : 'var(--ev-success, #16a34a)',
            fontSize: 'var(--ev-font-md)',
          }}
        >
          {formatBrl(tx.amountCents)}
        </strong>
      </header>

      {!loadedSuggestions ? (
        <button
          type="button"
          onClick={loadSuggestions}
          disabled={pending}
          className="ev-btn ev-btn-primary"
        >
          {pending ? 'Buscando…' : 'Buscar sugestões'}
        </button>
      ) : suggestions && suggestions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
          {suggestions.map((s) => {
            const name = s.candidate.supplierName ?? s.candidate.payerName ?? '—'
            const scorePct = Math.round(s.score * 100)
            return (
              <div
                key={s.candidate.id}
                style={{
                  padding: 'var(--ev-space-sm)',
                  borderRadius: 'var(--ev-radius)',
                  border: '1px solid var(--ev-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--ev-space-md)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div>
                    <span className="ev-badge">{s.candidate.kind.toUpperCase()}</span>{' '}
                    <strong>{name}</strong>
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    {s.candidate.description ?? ''} · vence {s.candidate.dueDate} ·{' '}
                    {formatBrl(s.candidate.amountCents)}
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    {s.reasons.join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <strong
                    style={{
                      color:
                        scorePct >= 90
                          ? 'var(--ev-success, #16a34a)'
                          : scorePct >= 70
                            ? 'var(--ev-info, #1e40af)'
                            : 'var(--ev-warning, #92400e)',
                    }}
                  >
                    {scorePct}%
                  </strong>
                  <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    match
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => confirmSugestion(s.candidate.kind, s.candidate.id)}
                  disabled={pending}
                  className="ev-btn ev-btn-primary"
                >
                  Conciliar
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p style={{ margin: 0, color: 'var(--ev-muted)', fontSize: 'var(--ev-font-sm)' }}>
          Nenhuma sugestão encontrada. Concilie manualmente via AP ou AR direto.
        </p>
      )}

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
