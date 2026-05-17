'use client'

import { useEffect, useState, useTransition } from 'react'
import { forecastCashflowAction } from './actions'

interface Point {
  date: string
  openingBalance: number
  inflowCents: number
  outflowCents: number
  closingBalance: number
  apCount: number
  arCount: number
}

interface ForecastResult {
  currentBalanceCents: number
  points: Point[]
  summary: {
    totalInflow: number
    totalOutflow: number
    minBalance: number
    maxBalance: number
    finalBalance: number
  }
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function CashflowChart() {
  const [pending, startTransition] = useTransition()
  const [daysAhead, setDaysAhead] = useState(30)
  const [data, setData] = useState<ForecastResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refresh(d: number) {
    setError(null)
    startTransition(async () => {
      const r = await forecastCashflowAction({ daysAhead: d })
      if (!r.ok) {
        setError(r.error.message)
        setData(null)
        return
      }
      setData(r.data as ForecastResult)
    })
  }

  useEffect(() => {
    refresh(daysAhead)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDays(d: number) {
    setDaysAhead(d)
    refresh(d)
  }

  return (
    <>
      <div
        className="ev-card"
        style={{
          padding: 'var(--ev-space-sm)',
          display: 'flex',
          gap: 'var(--ev-space-sm)',
        }}
      >
        {[7, 30, 60, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => handleDays(d)}
            className={daysAhead === d ? 'ev-btn ev-btn-primary' : 'ev-btn ev-btn-ghost'}
            disabled={pending}
          >
            {d}d
          </button>
        ))}
      </div>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      {pending && !data && <div style={{ color: 'var(--ev-muted)' }}>Calculando…</div>}

      {data && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 'var(--ev-space-md)',
            }}
          >
            <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Saldo atual
              </div>
              <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
                {formatBrl(data.currentBalanceCents)}
              </div>
            </div>
            <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Entradas previstas
              </div>
              <div
                style={{
                  fontSize: 'var(--ev-font-lg)',
                  fontWeight: 600,
                  color: 'var(--ev-success, #16a34a)',
                }}
              >
                {formatBrl(data.summary.totalInflow)}
              </div>
            </div>
            <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Saídas previstas
              </div>
              <div
                style={{
                  fontSize: 'var(--ev-font-lg)',
                  fontWeight: 600,
                  color: 'var(--ev-danger, #dc2626)',
                }}
              >
                {formatBrl(data.summary.totalOutflow)}
              </div>
            </div>
            <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Saldo projetado ({daysAhead}d)
              </div>
              <div
                style={{
                  fontSize: 'var(--ev-font-lg)',
                  fontWeight: 600,
                  color:
                    data.summary.finalBalance < 0
                      ? 'var(--ev-danger, #dc2626)'
                      : 'var(--ev-success, #16a34a)',
                }}
              >
                {formatBrl(data.summary.finalBalance)}
              </div>
            </div>
            <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Saldo mínimo
              </div>
              <div
                style={{
                  fontSize: 'var(--ev-font-lg)',
                  fontWeight: 600,
                  color:
                    data.summary.minBalance < 0
                      ? 'var(--ev-danger, #dc2626)'
                      : 'inherit',
                }}
              >
                {formatBrl(data.summary.minBalance)}
              </div>
            </div>
          </div>

          {data.summary.minBalance < 0 && (
            <div className="ev-alert ev-alert-danger" role="alert">
              <strong>⚠ Risco de saldo negativo</strong> no período. Mínimo projetado:{' '}
              {formatBrl(data.summary.minBalance)}. Considere antecipar recebimentos ou postergar
              pagamentos.
            </div>
          )}

          <div className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="ev-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Data</th>
                  <th style={{ textAlign: 'right' }}>Saldo inicial</th>
                  <th style={{ textAlign: 'right' }}>Entradas</th>
                  <th style={{ textAlign: 'right' }}>Saídas</th>
                  <th style={{ textAlign: 'right' }}>Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((p) => (
                  <tr
                    key={p.date}
                    style={{
                      backgroundColor:
                        p.closingBalance < 0 ? 'var(--ev-danger-bg, #fee2e2)' : 'transparent',
                    }}
                  >
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR', {
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatBrl(p.openingBalance)}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: p.inflowCents > 0 ? 'var(--ev-success, #16a34a)' : 'inherit',
                      }}
                    >
                      {p.inflowCents > 0 ? formatBrl(p.inflowCents) : '—'}
                      {p.arCount > 0 && (
                        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                          {' '}
                          ({p.arCount})
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: p.outflowCents > 0 ? 'var(--ev-danger, #dc2626)' : 'inherit',
                      }}
                    >
                      {p.outflowCents > 0 ? formatBrl(-p.outflowCents) : '—'}
                      {p.apCount > 0 && (
                        <span style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                          {' '}
                          ({p.apCount})
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        color: p.closingBalance < 0 ? 'var(--ev-danger, #dc2626)' : 'inherit',
                      }}
                    >
                      {formatBrl(p.closingBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
