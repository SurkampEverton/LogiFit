'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createCostEntry } from '../actions'

interface Category {
  id: string
  name: string
  icon: string | null
  type: 'fixed' | 'variable'
}
interface Company {
  id: string
  name: string
}

interface Props {
  categories: Category[]
  companies: Company[]
}

export function NewCostEntryForm({ categories, companies }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const companyId = String(fd.get('companyId'))
    const categoryId = String(fd.get('categoryId'))
    const amountReais = String(fd.get('amount') ?? '0').trim()
    const incurredAt = String(fd.get('incurredAt'))
    const description = String(fd.get('description') ?? '').trim()

    if (!companyId || !categoryId || !amountReais || !incurredAt) {
      setError('Empresa, categoria, valor e data obrigatórios')
      return
    }

    const amountCents = Math.round(Number(amountReais.replace(',', '.')) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Valor deve ser maior que zero')
      return
    }

    startTransition(async () => {
      const result = await createCostEntry({
        companyId,
        categoryId,
        amountCents,
        incurredAt,
        description: description || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/financeiro/custos')
      router.refresh()
    })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-[color:var(--ev-border)] p-6"
    >
      {error && (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Empresa *</span>
          <select
            name="companyId"
            required
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Categoria *</span>
          <select
            name="categoryId"
            required
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">(escolha)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ?? '💼'} {c.name} ({c.type === 'fixed' ? 'Fixo' : 'Variável'})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Valor (R$) *</span>
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="3500,00"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Data *</span>
          <input
            name="incurredAt"
            type="date"
            required
            defaultValue={today}
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Descrição</span>
          <textarea
            name="description"
            rows={2}
            placeholder="Aluguel maio 2026"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar custo'}
        </button>
      </div>
    </form>
  )
}
