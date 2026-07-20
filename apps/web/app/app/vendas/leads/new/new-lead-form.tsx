'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createLead } from '../../actions'

interface CompanyOption {
  id: string
  name: string | null
}

interface StageOption {
  id: string
  slug: string
  name: string
  orderIdx: number
}

interface Props {
  companies: CompanyOption[]
  stages: StageOption[]
}

const SOURCES = [
  'website',
  'instagram',
  'referral',
  'walk_in',
  'panfleto',
  'gympass',
  'totalpass',
  'outdoor',
  'other',
] as const

export function NewLeadForm({ companies, stages }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const quickName = String(fd.get('quickName') ?? '').trim()
    const quickPhone = String(fd.get('quickPhone') ?? '').trim()
    const quickEmail = String(fd.get('quickEmail') ?? '').trim()
    if (!quickName && !quickPhone) {
      setError('Informe ao menos nome OU telefone')
      return
    }
    startTransition(async () => {
      const result = await createLead({
        companyId: String(fd.get('companyId')),
        stageId: String(fd.get('stageId') || '') || undefined,
        quickName: quickName || undefined,
        quickPhone: quickPhone || undefined,
        quickEmail: quickEmail || undefined,
        source: String(fd.get('source')) as (typeof SOURCES)[number],
        interest: String(fd.get('interest') ?? '').trim() || undefined,
        notes: String(fd.get('notes') ?? '').trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push(`/app/vendas/leads/${result.data.id}`)
      router.refresh()
    })
  }

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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Empresa *</span>
          <select
            name="companyId"
            required
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? '—'}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Estágio</span>
          <select
            name="stageId"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">(automático — 1º estágio)</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Nome</span>
          <input
            name="quickName"
            type="text"
            placeholder="João Silva"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Telefone</span>
          <input
            name="quickPhone"
            type="tel"
            placeholder="(11) 91234-5678"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Email</span>
          <input
            name="quickEmail"
            type="email"
            placeholder="joao@email.com"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Origem</span>
          <select
            name="source"
            defaultValue="other"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">Interesse</span>
          <input
            name="interest"
            type="text"
            placeholder="Musculação · Personal · Pilates"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Notas</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
      </div>

      <p className="text-xs text-[color:var(--ev-text-muted)]">
        * Informe ao menos <strong>nome OU telefone</strong> pra captura mínima. Person/CPF poderá
        ser preenchida depois quando lead avançar pra proposta.
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar lead'}
        </button>
      </div>
    </form>
  )
}
