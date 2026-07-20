'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { requestAnticipationAction } from '../../actions'

interface SaleOption {
  id: string
  externalId: string
  capturedAt: string
  netAmountCents: number
  cardBrand: string
  cardKind: string
  installments: number
  expectedSettlementDate: string
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function daysUntil(date: string): number {
  const target = new Date(date + 'T00:00:00Z').getTime()
  const today = Date.now()
  return Math.max(0, Math.round((target - today) / 86_400_000))
}

export function AnticipationForm({
  connectionId,
  sales,
}: {
  connectionId: string
  sales: SaleOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [monthlyRate] = useState(1.99) // mock fixo

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function selectAll() {
    setSelected(new Set(sales.map((s) => s.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  const summary = useMemo(() => {
    const selectedSales = sales.filter((s) => selected.has(s.id))
    if (selectedSales.length === 0) return null
    const total = selectedSales.reduce((sum, s) => sum + s.netAmountCents, 0)
    const avgDays = Math.round(
      selectedSales.reduce((s, x) => s + daysUntil(x.expectedSettlementDate), 0) /
        selectedSales.length,
    )
    const ratePct = (monthlyRate * avgDays) / 30
    const feeCents = Math.round((total * ratePct) / 100)
    const anticipated = total - feeCents
    return { total, anticipated, feeCents, ratePct, avgDays, count: selectedSales.length }
  }, [sales, selected, monthlyRate])

  function submit() {
    setMessage(null)
    if (selected.size === 0) return setMessage('Selecione pelo menos uma venda')
    startTransition(async () => {
      const r = await requestAnticipationAction({
        connectionId,
        saleIds: Array.from(selected),
      })
      if (!r.ok) {
        setMessage(`Erro: ${r.error.message}`)
        return
      }
      setMessage(
        `✓ Antecipação ${r.data.status}: ${formatBrl(r.data.anticipatedCents ?? 0)} creditado`,
      )
      setSelected(new Set())
      router.refresh()
    })
  }

  return (
    <div className="ev-stack" style={{ gap: 'var(--ev-space-md)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={selectAll} className="ev-btn ev-btn-ghost">
          Selecionar todas
        </button>
        <button type="button" onClick={clearAll} className="ev-btn ev-btn-ghost">
          Limpar
        </button>
        <span style={{ flex: 1 }} />
        {summary && (
          <button onClick={submit} className="ev-btn ev-btn-primary" disabled={pending}>
            {pending ? 'Solicitando...' : `Antecipar ${summary.count} vendas`}
          </button>
        )}
      </div>

      {summary && (
        <div
          className="ev-card"
          style={{
            padding: 'var(--ev-space-md)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--ev-space-md)',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Original</div>
            <div style={{ fontSize: 'var(--ev-font-md)', fontWeight: 600 }}>
              {formatBrl(summary.total)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              Taxa estimada
            </div>
            <div
              style={{
                fontSize: 'var(--ev-font-md)',
                fontWeight: 600,
                color: 'var(--ev-danger, #b91c1c)',
              }}
            >
              − {formatBrl(summary.feeCents)} ({summary.ratePct.toFixed(2)}%)
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              Antecipado
            </div>
            <div
              style={{
                fontSize: 'var(--ev-font-md)',
                fontWeight: 600,
                color: 'var(--ev-success, #16a34a)',
              }}
            >
              {formatBrl(summary.anticipated)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              Dias média
            </div>
            <div style={{ fontSize: 'var(--ev-font-md)', fontWeight: 600 }}>{summary.avgDays}d</div>
          </div>
        </div>
      )}

      {message && <div className="ev-banner ev-banner-info">{message}</div>}

      <table className="ev-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: 40 }}></th>
            <th>NSU</th>
            <th>Captura</th>
            <th>Bandeira</th>
            <th>Parc.</th>
            <th style={{ textAlign: 'right' }}>Líquido</th>
            <th>Settlement</th>
            <th>Dias</th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              </td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>{s.externalId.slice(-12)}</td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                {new Date(s.capturedAt).toLocaleDateString('pt-BR')}
              </td>
              <td>{s.cardBrand}</td>
              <td>{s.installments}x</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatBrl(s.netAmountCents)}</td>
              <td style={{ fontSize: 'var(--ev-font-xs)' }}>{s.expectedSettlementDate}</td>
              <td>{daysUntil(s.expectedSettlementDate)}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
