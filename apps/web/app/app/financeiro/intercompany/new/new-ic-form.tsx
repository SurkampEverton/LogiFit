'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createIntercompanyEntry } from '../actions'

interface Company {
  id: string
  name: string
  personId: string
  type: string
}

type Kind = 'payment' | 'transfer' | 'service' | 'goods' | 'adjustment'

const KIND_LABELS: Record<Kind, string> = {
  payment: 'Pagamento (matriz pagou pela filial)',
  transfer: 'Transferência (dinheiro entre contas)',
  service: 'Serviço (empresa A prestou para B)',
  goods: 'Bens (transferência física — pode exigir NF-e)',
  adjustment: 'Ajuste contábil (zera saldo)',
}

function parseBrlToCents(value: string): number {
  const cleaned = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

export function NewICForm({ companies }: { companies: Company[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fromCompanyId, setFromCompanyId] = useState(companies[0]?.id ?? '')
  const [toCompanyId, setToCompanyId] = useState(companies[1]?.id ?? '')
  const [amountInput, setAmountInput] = useState('')
  const [kind, setKind] = useState<Kind>('payment')
  const [notes, setNotes] = useState('')

  const fromCompany = companies.find((c) => c.id === fromCompanyId)
  const toCompany = companies.find((c) => c.id === toCompanyId)
  const cnpjsDistinct = fromCompany && toCompany && fromCompany.personId !== toCompany.personId
  const willTriggerNfe = kind === 'goods' && cnpjsDistinct

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (fromCompanyId === toCompanyId) return setError('Companies devem ser distintas')
    const cents = parseBrlToCents(amountInput)
    if (cents <= 0) return setError('Valor inválido')
    startTransition(async () => {
      const r = await createIntercompanyEntry({
        fromCompanyId,
        toCompanyId,
        amountCents: cents,
        kind,
        notes: notes || undefined,
      })
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      router.push('/app/financeiro/intercompany')
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="ev-card"
      style={{
        padding: 'var(--ev-space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-md)',
        maxWidth: 720,
      }}
    >
      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>De (company que pagou/transferiu)</span>
          <select
            value={fromCompanyId}
            onChange={(e) => setFromCompanyId(e.target.value)}
            className="ev-input"
            required
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.type === 'matriz' ? '(matriz)' : ''}
              </option>
            ))}
          </select>
        </label>
        <span style={{ alignSelf: 'flex-end', padding: '8px 4px', color: 'var(--ev-muted)' }}>
          →
        </span>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Para (company beneficiária)</span>
          <select
            value={toCompanyId}
            onChange={(e) => setToCompanyId(e.target.value)}
            className="ev-input"
            required
          >
            {companies
              .filter((c) => c.id !== fromCompanyId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.type === 'matriz' ? '(matriz)' : ''}
                </option>
              ))}
          </select>
        </label>
      </div>

      {fromCompany && toCompany && !cnpjsDistinct && (
        <div
          style={{
            padding: 'var(--ev-space-sm)',
            backgroundColor: 'var(--ev-muted-bg, #f3f4f6)',
            borderRadius: 'var(--ev-radius)',
            fontSize: 'var(--ev-font-xs)',
            color: 'var(--ev-muted)',
          }}
        >
          ℹ Companies têm o mesmo CNPJ (raro — talvez matriz e filial compartilhando persons). Não
          dispara NF-e mesmo em kind=goods.
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Tipo</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="ev-input">
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {willTriggerNfe && (
        <div
          className="ev-alert ev-alert-warning"
          role="alert"
          style={{ padding: 'var(--ev-space-sm)' }}
        >
          ⚠ Bens entre CNPJs distintos exigem NF-e de transferência (CFOP 5.151/6.151). Sprint 36
          ativa emissão via Focus NFe. Até lá, emita externamente e registre a chave manualmente.
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Valor (R$)</span>
        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          className="ev-input"
          placeholder="0,00"
          required
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Notas / Descrição</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="ev-input"
          rows={3}
          placeholder="Ex: Matriz pagou conta de energia da filial 1; rateio mensal de software"
        />
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Criar lançamento'}
        </button>
      </div>
    </form>
  )
}
