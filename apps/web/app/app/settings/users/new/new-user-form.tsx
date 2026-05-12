'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createUser } from '../actions'

interface AvailablePerson {
  id: string
  name: string
  email: string | null
  document: string | null
}

interface AvailableRole {
  id: string
  key: string
  label: string
  requiresMfa: boolean
}

export function NewUserForm({
  availablePersons,
  availableRoles,
}: {
  availablePersons: AvailablePerson[]
  availableRoles: AvailableRole[]
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState('')
  const [username, setUsername] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handlePersonChange(value: string) {
    setPersonId(value)
    // Auto-preenche username com email da pessoa
    const p = availablePersons.find((x) => x.id === value)
    if (p?.email && !username) setUsername(p.email)
  }

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await createUser({
      personId,
      username,
      roleIds,
    })

    setSubmitting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    router.push('/app/settings/users')
    router.refresh()
  }

  const selectedRolesRequireMfa = roleIds.some(
    (id) => availableRoles.find((r) => r.id === id)?.requiresMfa,
  )

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
          onChange={(e) => handlePersonChange(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        >
          <option value="">Selecione…</option>
          {availablePersons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.document && ` (${p.document})`}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="username" className="block text-sm font-medium">
          Email de login <span className="text-[color:var(--ev-danger)]">*</span>
        </label>
        <input
          id="username"
          type="email"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="block w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-input-bg)] px-3 py-2 text-base"
          style={{ minHeight: 'var(--ev-input-min, 48px)' }}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium">
          Roles <span className="text-[color:var(--ev-danger)]">*</span>
        </legend>
        <div className="space-y-2 rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-3">
          {availableRoles.map((r) => (
            <label key={r.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={() => toggleRole(r.id)}
                className="h-4 w-4 rounded border-[color:var(--ev-border)]"
              />
              <span className="text-sm">{r.label}</span>
              {r.requiresMfa && (
                <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
                  MFA obrigatório
                </span>
              )}
            </label>
          ))}
        </div>
        {selectedRolesRequireMfa && (
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            Este usuário deverá habilitar MFA TOTP no primeiro login (regra 43).
          </p>
        )}
      </fieldset>

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
          disabled={submitting || !personId || !username || roleIds.length === 0}
          className="flex-1 rounded-md bg-[color:var(--ev-primary)] px-4 py-3 text-base font-medium text-[color:var(--ev-primary-foreground)] disabled:opacity-50"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          {submitting ? 'Criando…' : 'Criar usuário'}
        </button>
        <a
          href="/app/settings/users"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-3 text-base font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
