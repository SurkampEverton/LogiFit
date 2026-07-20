'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createPlan } from '../../actions'

interface CompanyOption {
  id: string
  name: string
  type: string
}

const CYCLE_OPTIONS: Array<{ value: 'monthly' | 'quarterly' | 'yearly'; label: string }> = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'yearly', label: 'Anual' },
]

function parseBRLToCents(value: string): number {
  const digits = value.replace(/\D/g, '')
  return Number.parseInt(digits || '0', 10)
}

function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

export function NewPlanForm({ availableCompanies }: { availableCompanies: CompanyOption[] }) {
  const router = useRouter()
  const [companyId, setCompanyId] = useState(availableCompanies[0]?.id ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priceInput, setPriceInput] = useState('') // digitação livre
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly')
  const [trialDays, setTrialDays] = useState('0')
  const [cancelNoticeDays, setCancelNoticeDays] = useState('0')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const priceCents = parseBRLToCents(priceInput)
    if (priceCents <= 0) {
      setError('Preço deve ser maior que zero')
      setSubmitting(false)
      return
    }
    const result = await createPlan({
      companyId,
      name: name.trim(),
      description: description.trim() || undefined,
      priceCents,
      billingCycle,
      trialDays: Number.parseInt(trialDays, 10) || 0,
      cancelNoticeDays: Number.parseInt(cancelNoticeDays, 10) || 0,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push('/app/financeiro/planos')
    router.refresh()
  }

  const priceCents = parseBRLToCents(priceInput)

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="companyId" className="block text-sm font-medium">
          Empresa <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="companyId"
          required
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          {availableCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium">
          Nome <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <input
          id="name"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Plano Mensal Musculação"
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium">
          Descrição
        </label>
        <textarea
          id="description"
          maxLength={2000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="O que está incluso, regras de uso, etc"
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="price" className="block text-sm font-medium">
            Preço (R$) <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <input
            id="price"
            type="text"
            inputMode="numeric"
            required
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="0,00"
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 tabular-nums"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
          {priceCents > 0 && (
            <p className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
              R$ {formatCentsBRL(priceCents)}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cycle" className="block text-sm font-medium">
            Ciclo de cobrança <span className="text-[color:var(--ev-danger)]">*</span>
          </label>
          <select
            id="cycle"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as 'monthly' | 'quarterly' | 'yearly')}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          >
            {CYCLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="trialDays" className="block text-sm font-medium">
            Dias de trial
          </label>
          <input
            id="trialDays"
            type="number"
            min={0}
            max={90}
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cancelNoticeDays" className="block text-sm font-medium">
            Aviso prévio cancelamento (dias)
          </label>
          <input
            id="cancelNoticeDays"
            type="number"
            min={0}
            max={60}
            value={cancelNoticeDays}
            onChange={(e) => setCancelNoticeDays(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] p-3 text-sm text-[color:var(--ev-danger)]"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !companyId || !name.trim() || priceCents <= 0}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Cadastrando…' : 'Cadastrar plano'}
        </button>
        <a
          href="/app/financeiro/planos"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
