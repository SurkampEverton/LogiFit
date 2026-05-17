'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { createAP, submitForApproval } from '../actions'

interface Company {
  id: string
  name: string
}
interface Supplier {
  id: string
  name: string
  document: string | null
  defaultTerm: number | null
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

function dueDateFromTerm(termDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + termDays)
  return d.toISOString().slice(0, 10)
}

function parseBrlToCents(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

export function NewAPForm({
  companies,
  suppliers,
  leafAccounts,
}: {
  companies: Company[]
  suppliers: Supplier[]
  leafAccounts: LeafAccount[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [supplierId, setSupplierId] = useState<string>('')
  const [chartAccountId, setChartAccountId] = useState<string>('')
  const [amountInput, setAmountInput] = useState('')
  const [issueDate, setIssueDate] = useState(todayISO())
  const [dueDate, setDueDate] = useState(dueDateFromTerm(30))
  const [description, setDescription] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [submitForApprovalAfter, setSubmitForApprovalAfter] = useState(true)

  const amountCents = useMemo(() => parseBrlToCents(amountInput), [amountInput])

  // Quando supplier muda, preenche dueDate baseado em defaultTerm
  useEffect(() => {
    if (!supplierId) return
    const supp = suppliers.find((s) => s.id === supplierId)
    if (supp?.defaultTerm != null) {
      setDueDate(dueDateFromTerm(supp.defaultTerm))
    }
  }, [supplierId, suppliers])

  // Filtra leaves: pra AP normalmente kind = despesa/custo/passivo
  const filteredLeaves = leafAccounts.filter((a) =>
    ['despesa', 'custo', 'passivo'].includes(a.kind),
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!companyId) return setError('Selecione empresa')
    if (!chartAccountId) return setError('Selecione conta contábil')
    if (amountCents <= 0) return setError('Valor inválido')
    if (dueDate < issueDate) return setError('Vencimento não pode ser antes da emissão')
    startTransition(async () => {
      const created = await createAP({
        companyId,
        supplierId: supplierId || null,
        chartAccountId,
        amountCents,
        issueDate,
        dueDate,
        description: description || undefined,
        docNumber: docNumber || undefined,
        noInvoice: false,
      })
      if (!created.ok) {
        setError(created.error.message)
        return
      }
      if (submitForApprovalAfter) {
        const sub = await submitForApproval({ apId: created.data.id })
        if (!sub.ok) {
          setError(`AP criada mas falhou submeter: ${sub.error.message}`)
          router.push(`/app/financeiro/contas-pagar/${created.data.id}`)
          return
        }
      }
      router.push(`/app/financeiro/contas-pagar/${created.data.id}`)
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
        <span>Fornecedor (opcional)</span>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="ev-input"
        >
          <option value="">(sem fornecedor — gasto eventual)</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.document ? `· ${s.document}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Conta contábil (folha)</span>
        <select
          value={chartAccountId}
          onChange={(e) => setChartAccountId(e.target.value)}
          className="ev-input"
          required
        >
          <option value="">(escolha)</option>
          {filteredLeaves.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
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
          {amountCents > 0 && (
            <small style={{ color: 'var(--ev-muted)' }}>
              = {(amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </small>
          )}
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
        <span>Nº documento (NF/boleto — opcional)</span>
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
          placeholder="Ex: Aluguel de maio matriz"
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={submitForApprovalAfter}
          onChange={(e) => setSubmitForApprovalAfter(e.target.checked)}
        />
        <span>Submeter à aprovação imediatamente (caso contrário fica em rascunho)</span>
      </label>

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}

      <div>
        <button type="submit" className="ev-btn ev-btn-primary" disabled={pending}>
          {pending ? 'Salvando…' : 'Criar AP'}
        </button>
      </div>
    </form>
  )
}
