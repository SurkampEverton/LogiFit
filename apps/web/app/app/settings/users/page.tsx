import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { listUsers } from './actions'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  await requireFullSession('/app/settings/users')
  const result = await listUsers()

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Operadores do tenant. Roles profissionais (médico, fisio, nutri…) exigem MFA TOTP (regra
            43).
          </p>
        </div>
        <Link
          href="/app/settings/users/new"
          className="inline-flex items-center rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm font-medium text-[color:var(--ev-primary-foreground)] hover:opacity-90"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Convidar usuário
        </Link>
      </header>

      {!result.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro: {result.error.message}
        </div>
      ) : result.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhum usuário ainda — convide o primeiro.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--ev-border)] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)]">
          {result.data.map((u) => (
            <li key={u.id} className="px-4 py-3 space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{u.personName}</span>
                <span className="text-sm text-[color:var(--ev-text-muted)]">{u.username}</span>
                {!u.authUserId && (
                  <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
                    convite pendente
                  </span>
                )}
                {u.mfaEnabled && (
                  <span className="text-xs rounded-full bg-[color:var(--ev-success-bg)] px-2 py-0.5">
                    MFA
                  </span>
                )}
              </div>
              {u.roleKeys.length > 0 && (
                <p className="text-xs text-[color:var(--ev-text-muted)]">
                  Roles: {u.roleKeys.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
