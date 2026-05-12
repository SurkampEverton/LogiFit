'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createFilial } from '../actions'

interface AvailablePerson {
  id: string
  name: string
  document: string | null
}

export function NewFilialForm({ availablePersons }: { availablePersons: AvailablePerson[] }) {
  const router = useRouter()
  const [personId, setPersonId] = useState('')
  const [ie, setIe] = useState('')
  const [im, setIm] = useState('')
  const [regimeTributario, setRegimeTributario] = useState<
    'simples' | 'presumido' | 'real' | 'mei' | ''
  >('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await createFilial({
      personId,
      ie: ie || undefined,
      im: im || undefined,
      regimeTributario: regimeTributario || undefined,
    })

    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push('/app/settings/empresas')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="personId" className="block text-sm font-medium">
          Pessoa Jurídica <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <select
          id="personId"
          required
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
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
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ie" className="block text-sm font-medium">
          Inscrição Estadual (IE)
        </label>
        <input
          id="ie"
          type="text"
          value={ie}
          onChange={(e) => setIe(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="im" className="block text-sm font-medium">
          Inscrição Municipal (IM)
        </label>
        <input
          id="im"
          type="text"
          value={im}
          onChange={(e) => setIm(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="regime" className="block text-sm font-medium">
          Regime Tributário
        </label>
        <select
          id="regime"
          value={regimeTributario}
          onChange={(e) =>
            setRegimeTributario(e.target.value as typeof regimeTributario)
          }
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Selecione…</option>
          <option value="mei">MEI</option>
          <option value="simples">Simples Nacional</option>
          <option value="presumido">Lucro Presumido</option>
          <option value="real">Lucro Real</option>
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

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !personId}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-base font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Criando…' : 'Criar filial'}
        </button>
        <a
          href="/app/settings/empresas"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 text-base font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
