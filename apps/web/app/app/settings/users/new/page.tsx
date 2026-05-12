import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { listAssignableRoles, listAvailablePfPersons } from '../actions'
import { NewUserForm } from './new-user-form'

export const dynamic = 'force-dynamic'

export default async function NewUserPage() {
  await requireFullSession('/app/settings/users/new')
  const [persons, roles] = await Promise.all([listAvailablePfPersons(), listAssignableRoles()])

  return (
    <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/settings/users"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Convidar usuário</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Selecione uma pessoa física já cadastrada e atribua roles. Roles profissionais (médico,
          fisio…) exigem MFA TOTP no primeiro login.
        </p>
      </header>

      {!persons.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro ao listar PFs: {persons.error.message}
        </div>
      ) : !roles.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro ao listar roles: {roles.error.message}
        </div>
      ) : persons.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma PF disponível —{' '}
          <Link
            href="/app/pessoas/new"
            className="font-medium text-[color:var(--ev-primary)] hover:underline"
          >
            cadastre uma pessoa
          </Link>{' '}
          primeiro.
        </div>
      ) : (
        <NewUserForm availablePersons={persons.data} availableRoles={roles.data} />
      )}
    </main>
  )
}
