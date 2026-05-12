'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createMember } from '../actions'

interface PersonOption {
  id: string
  name: string
  email: string | null
  document: string | null
}

interface CompanyOption {
  id: string
  name: string
  type: string
}

export function NewMemberForm({
  availablePersons,
  availableCompanies,
}: {
  availablePersons: PersonOption[]
  availableCompanies: CompanyOption[]
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState('')
  const [companyId, setCompanyId] = useState(availableCompanies[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await createMember({ personId, companyId })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push(`/app/members/${result.data.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="personId" className="block text-sm font-medium">
          Pessoa Física <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="personId"
          required
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Selecione…</option>
          {availablePersons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.document && ` — ${p.document}`}
            </option>
          ))}
        </select>
        <p className="text-xs text-[color:var(--ev-text-muted)]">
          Não vê a pessoa?{' '}
          <a
            href="/app/pessoas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            Cadastre PF nova primeiro
          </a>
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="companyId" className="block text-sm font-medium">
          Company (regra 25 — fisio só vê na sua company){' '}
          <span className="text-[color:var(--ev-danger)]">*</span>
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
          disabled={submitting || !personId || !companyId}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Cadastrando…' : 'Cadastrar member'}
        </button>
        <a
          href="/app/members"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
