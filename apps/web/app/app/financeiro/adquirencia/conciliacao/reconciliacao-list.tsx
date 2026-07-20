'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { reconcileSale, suggestSettlementMatchesAction } from '../actions'

interface PendingSale {
  id: string
  externalId: string
  provider: string
  connectionNickname: string
  capturedAt: string
  netAmountCents: number
  cardBrand: string
  cardKind: string
  expectedSettlementDate: string
  status: string
  display: string
}

interface Suggestion {
  bankTx: {
    id: string
    amountCents: number
    postedAt: string
    description: string
    bankAccountId: string
  }
  score: number
  reasons: string[]
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function scoreColor(score: number): string {
  if (score >= 0.9) return 'var(--ev-success-soft, #dcfce7)'
  if (score >= 0.7) return 'var(--ev-info-soft, #eff6ff)'
  if (score >= 0.5) return 'var(--ev-warning-soft, #fef9c3)'
  return 'var(--ev-surface)'
}

export function ReconciliacaoList({ sales }: { sales: PendingSale[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [suggestionsBySale, setSuggestions] = useState<Record<string, Suggestion[]>>({})
  const [errorBySale, setErrors] = useState<Record<string, string>>({})

  function loadSuggestions(saleId: string) {
    setErrors((e) => ({ ...e, [saleId]: '' }))
    startTransition(async () => {
      const r = await suggestSettlementMatchesAction({ saleId, maxResults: 3 })
      if (!r.ok) {
        setErrors((e) => ({ ...e, [saleId]: r.error.message }))
        return
      }
      setSuggestions((s) => ({ ...s, [saleId]: r.data.suggestions }))
    })
  }

  function confirm(saleId: string, bankTxId: string) {
    startTransition(async () => {
      const r = await reconcileSale({ saleId, bankTxId })
      if (!r.ok) {
        setErrors((e) => ({ ...e, [saleId]: r.error.message }))
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      {sales.map((s) => {
        const sugs = suggestionsBySale[s.id]
        const error = errorBySale[s.id]
        return (
          <div key={s.id} className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <strong>{s.display}</strong>
              <span className="ev-badge">{s.provider}</span>
              <span style={{ color: 'var(--ev-muted)', fontSize: 'var(--ev-font-xs)' }}>
                {s.connectionNickname} · NSU {s.externalId.slice(-10)}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Settlement {s.expectedSettlementDate}
              </span>
              {!sugs && (
                <button
                  onClick={() => loadSuggestions(s.id)}
                  className="ev-btn ev-btn-primary"
                  disabled={pending}
                >
                  {pending ? '...' : 'Buscar sugestões'}
                </button>
              )}
            </div>

            {error && (
              <div className="ev-banner ev-banner-danger" style={{ marginTop: 8 }}>
                {error}
              </div>
            )}

            {sugs && sugs.length === 0 && (
              <p style={{ marginTop: 8, color: 'var(--ev-muted)' }}>
                Nenhum candidato encontrado em ± 7 dias do settlement. Importe extrato bancário ou
                aguarde settle.
              </p>
            )}

            {sugs && sugs.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 8,
                }}
              >
                {sugs.map((sug) => (
                  <div
                    key={sug.bankTx.id}
                    style={{
                      padding: 12,
                      borderRadius: 'var(--ev-radius)',
                      background: scoreColor(sug.score),
                      border: '1px solid var(--ev-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <strong>{formatBrl(sug.bankTx.amountCents)}</strong>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontWeight: 600 }}>{Math.round(sug.score * 100)}%</span>
                    </div>
                    <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                      {new Date(sug.bankTx.postedAt).toLocaleDateString('pt-BR')} ·{' '}
                      {sug.bankTx.description}
                    </div>
                    {sug.reasons.length > 0 && (
                      <div style={{ fontSize: 'var(--ev-font-xs)', marginTop: 4 }}>
                        {sug.reasons.join(' · ')}
                      </div>
                    )}
                    <button
                      onClick={() => confirm(s.id, sug.bankTx.id)}
                      className="ev-btn ev-btn-primary"
                      style={{ marginTop: 8, width: '100%' }}
                      disabled={pending}
                    >
                      Conciliar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
