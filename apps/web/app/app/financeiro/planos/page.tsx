/**
 * `/app/financeiro/planos` — lista + ações sobre planos (Sprint 04 Faixa C).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { listPlans } from '../actions'

export const dynamic = 'force-dynamic'

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function PlanosPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  await requireFullSession('/app/financeiro/planos')
  const params = await searchParams
  const includeArchived = params.archived === '1'

  const result = await listPlans({ includeArchived, limit: 200 })
  const plans = result.ok ? result.data.plans : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href="/app/financeiro"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Financeiro
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planos</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Catálogo de planos comerciais — preço congelado por contrato.
          </p>
        </div>
        <Link
          href="/app/financeiro/planos/new"
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Novo plano
        </Link>
      </header>

      <div className="flex items-center gap-3 text-sm">
        <Link
          href={includeArchived ? '/app/financeiro/planos' : '/app/financeiro/planos?archived=1'}
          className="text-[color:var(--ev-primary)] hover:underline"
        >
          {includeArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
        </Link>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">Nenhum plano cadastrado.</p>
          <Link
            href="/app/financeiro/planos/new"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Cadastrar primeiro plano →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Preço</th>
                <th className="px-4 py-3 font-medium">Ciclo</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 tabular-nums">{formatBRL(p.priceCents)}</td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                    {CYCLE_LABEL[p.billingCycle] ?? p.billingCycle}
                  </td>
                  <td className="px-4 py-3">
                    {p.archivedAt ? (
                      <span className="text-[color:var(--ev-text-muted)]">Arquivado</span>
                    ) : p.active ? (
                      <span className="text-[color:var(--ev-success, #10b981)]">Ativo</span>
                    ) : (
                      <span className="text-[color:var(--ev-text-muted)]">Inativo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
