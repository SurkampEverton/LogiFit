'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { createAR, markARIssued } from '../actions'

interface Company {
  id: string
  name: string
}
interface Payer {
  id: string
  name: string
  document: string | null
  kind: 'pf' | 'pj'
}
interface LeafAccount {
  id: string
  code: string
  name: string
  kind: string
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function dueIn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
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

export function NewARForm({
  companies,
  payers,
  leafAccounts,
}: {
  companies: Company[]
  payers: Payer[]
  leafAccounts: LeafAccount[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [payerId, setPayerId] = useState('')
  const [chartAccountId, setChartAccountId] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [issueDate, setIssueDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState(dueIn(7))
  const [description, setDescription] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [markIssued, setMarkIssued] = useState(true)
  const [payerQuery, setPayerQuery] = useState('')

  const amountCents = useMemo(() => parseBrlToCents(amountInput), [amountInput])
  const filteredPayers = payerQuery
    ? payers.filter(
        (p) =>
          p.name.toLowerCase().includes(payerQuery.toLowerCase()) ||
          (p.document ?? '').includes(payerQuery),
      )
    : payers

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyId) return setError('Empresa obrigatória')
    if (!chartAccountId) return setError('Conta contábil obrigatória')
    if (amountCents <= 0) return setError('Valor inválido')
    if (dueDate < issueDate) return setError('Vencimento não pode ser antes da emissão')
    startTransition(async () => {
      const created = await createAR({
        companyId,
        payerPersonId: payerId || null,
        chartAccountId,
        amountCents,
        issueDate,
        dueDate,
        description: description || undefined,
        docNumber: docNumber || undefined,
      })
      if (!created.ok) {
        setError(created.error.message)
        return
      }
      if (markIssued) {
        await markARIssued({ arId: created.data.id })
      }
      router.push(`/app/financeiro/contas-receber/${created.data.id}`)
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
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Empresa</span>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="ev-input"
          required
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Buscar pagador</span>
        <input
          type="text"
          value={payerQuery}
          onChange={(e) => setPayerQuery(e.target.value)}
          placeholder="Nome ou documento"
          className="ev-input"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Pagador (opcional)</span>
        <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className="ev-input">
          <option value="">(sem pagador — recebimento anônimo)</option>
          {filteredPayers.slice(0, 50).map((p) => (
            <option key={p.id} value={p.id}>
              {p.kind.toUpperCase()} · {p.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Conta contábil (receita ou ativo)</span>
        <select
          value={chartAccountId}
          onChange={(e) => setChartAccountId(e.target.value)}
          className="ev-input"
          required
        >
          <option value="">(escolha)</option>
          {leafAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name} ({a.kind})
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', gap: 'var(--ev-space-md)' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Emissão</span>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="ev-input"
            required
          />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Vencimento</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="ev-input"
            required
          />
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Nº documento (opcional)</span>
        <input
          type="text"
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
          className="ev-input"
          maxLength={60}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Descrição</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="ev-input"
          rows={2}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={markIssued}
          onChange={(e) => setMarkIssued(e.target.checked)}
        />
        <span>Marcar como emitida imediatamente (caso contrário fica em rascunho)</span>
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Criar AR'}
        </button>
      </div>
    </form>
  )
}
