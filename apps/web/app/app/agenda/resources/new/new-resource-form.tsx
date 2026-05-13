'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createResource } from '../../actions'

interface CompanyOption {
  id: string
  name: string
  type: string
}

const KIND_OPTIONS: Array<{ value: 'instrutor' | 'sala' | 'equipamento'; label: string }> = [
  { value: 'instrutor', label: '👤 Instrutor' },
  { value: 'sala', label: '🚪 Sala' },
  { value: 'equipamento', label: '🏋️ Equipamento' },
]

const MODALITY_OPTIONS = [
  { value: '', label: 'Sem modalidade' },
  { value: 'musculacao', label: 'Musculação' },
  { value: 'coletiva', label: 'Aula coletiva' },
  { value: 'personal', label: 'Personal' },
]

export function NewResourceForm({
  availableCompanies,
}: {
  availableCompanies: CompanyOption[]
}) {
  const router = useRouter()
  const [companyId, setCompanyId] = useState(availableCompanies[0]?.id ?? '')
  const [kind, setKind] = useState<'instrutor' | 'sala' | 'equipamento'>('instrutor')
  const [name, setName] = useState('')
  const [modality, setModality] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await createResource({
      companyId,
      kind,
      name: name.trim(),
      modality: modality || null,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push('/app/agenda/resources')
    router.refresh()
  }

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
        <label htmlFor="kind" className="block text-sm font-medium">
          Tipo <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="kind"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value as 'instrutor' | 'sala' | 'equipamento')}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
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
          placeholder={
            kind === 'instrutor'
              ? 'Ex: João Silva'
              : kind === 'sala'
                ? 'Ex: Sala de Pilates 1'
                : 'Ex: Bicicleta ergométrica 3'
          }
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      {kind === 'instrutor' && (
        <div className="space-y-1.5">
          <label htmlFor="modality" className="block text-sm font-medium">
            Modalidade (Academia)
          </label>
          <select
            id="modality"
            value={modality}
            onChange={(e) => setModality(e.target.value)}
            className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2"
            style={{ minHeight: 'var(--ev-input-min, 48px)' }}
          >
            {MODALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            Só preenchido em vertical Academia. Fisio/Nutri não usam.
          </p>
        </div>
      )}

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
          disabled={submitting || !companyId || !name.trim()}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Cadastrando…' : 'Cadastrar recurso'}
        </button>
        <a
          href="/app/agenda/resources"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
