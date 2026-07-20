import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { listCompanies } from './actions'

export const dynamic = 'force-dynamic'

export default async function EmpresasPage() {
  await requireFullSession('/app/settings/empresas')
  const result = await listCompanies()

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Matriz + filiais do seu tenant. Regra: 1 matriz por tenant; filiais herdam CNPJ próprio
            mas operam sob a estrutura da matriz.
          </p>
        </div>
        <Link
          href="/app/settings/empresas/new"
          className="inline-flex items-center rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm font-medium text-[color:var(--ev-primary-foreground)] hover:opacity-90"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Nova filial
        </Link>
      </header>

      {!result.ok ? (
        <div role="alert" className="rounded-md border border-[color:var(--ev-danger)] p-4 text-sm">
          Erro ao listar empresas: {result.error.message}
        </div>
      ) : result.data.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma empresa — execute <code>/signup</code> pra criar a matriz.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--ev-border)] rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)]">
          {result.data.map((c) => (
            <li key={c.id} className="px-4 py-3 space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{c.personName}</span>
                <span
                  className={`text-xs uppercase rounded-full px-2 py-0.5 ${
                    c.type === 'matriz'
                      ? 'bg-[color:var(--ev-primary)] text-[color:var(--ev-primary-foreground)]'
                      : 'bg-[color:var(--ev-surface)] border border-[color:var(--ev-border)]'
                  }`}
                >
                  {c.type}
                </span>
                {c.document && (
                  <span className="text-sm text-[color:var(--ev-text-muted)]">
                    CNPJ: {c.document}
                  </span>
                )}
              </div>
              {(c.ie || c.regimeTributario) && (
                <p className="text-xs text-[color:var(--ev-text-muted)]">
                  {c.ie && `IE: ${c.ie}`}
                  {c.ie && c.regimeTributario && ' · '}
                  {c.regimeTributario && `Regime: ${c.regimeTributario}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
