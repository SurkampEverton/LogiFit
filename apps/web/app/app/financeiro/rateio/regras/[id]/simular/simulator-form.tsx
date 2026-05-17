'use client'

import { useState, useTransition } from 'react'
import { simulateAllocation } from '../../actions'

interface CompanyOption {
  id: string
  name: string
}

interface AllocationResult {
  companyId: string
  amountCents: number
  percentApplied: number
  companyPersonId?: string | null
}

function parseBrlToCents(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function SimulatorForm({
  ruleId,
  companies,
}: {
  ruleId: string
  companies: CompanyOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('10000,00')
  const [result, setResult] = useState<AllocationResult[]>([])
  const [contextSnapshot, setContextSnapshot] = useState<unknown>(null)

  const nameById = new Map(companies.map((c) => [c.id, c.name]))

  function simulate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const cents = parseBrlToCents(amountInput)
    if (cents <= 0) {
      setError('Valor inválido')
      return
    }
    startTransition(async () => {
      const r = await simulateAllocation({ ruleId, amountCents: cents })
      if (!r.ok) {
        setError(r.error.message)
        setResult([])
        return
      }
      setResult(r.data.allocations as AllocationResult[])
      setContextSnapshot(r.data.contextSnapshot)
    })
  }

  const total = result.reduce((s, a) => s + a.amountCents, 0)

  return (
    <>
      <form
        onSubmit={simulate}
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'flex',
          gap: 'var(--ev-space-md)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Valor de AP a ratear (R$)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="ev-input"
            placeholder="10.000,00"
          />
        </label>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Calculando…' : 'Simular'}
        </button>
      </form>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      {result.length > 0 && (
        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <header
            style={{
              padding: 'var(--ev-space-md)',
              borderBottom: '1px solid var(--ev-border)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--ev-space-md)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Distribuição</h2>
            <span style={{ color: 'var(--ev-muted)' }}>
              Total: <strong>{formatBrl(total)}</strong>
            </span>
          </header>
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Company</th>
                <th style={{ textAlign: 'right' }}>%</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {result.map((a) => (
                <tr key={a.companyId}>
                  <td>{nameById.get(a.companyId) ?? a.companyId.slice(0, 8)}</td>
                  <td style={{ textAlign: 'right' }}>{a.percentApplied.toFixed(2)}%</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(a.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {contextSnapshot != null && (
            <details style={{ padding: 'var(--ev-space-md)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--ev-font-sm)' }}>
                Ver contexto usado no cálculo (snapshot)
              </summary>
              <pre style={{ fontSize: 'var(--ev-font-xs)', overflow: 'auto' }}>
                {JSON.stringify(contextSnapshot, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}
    </>
  )
}
