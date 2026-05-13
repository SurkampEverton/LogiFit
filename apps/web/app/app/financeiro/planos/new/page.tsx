/**
 * `/app/financeiro/planos/new` — wizard novo plano (Sprint 04 Faixa C).
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'
import { NewPlanForm } from './new-plan-form'

export const dynamic = 'force-dynamic'

interface CompanyOption {
  id: string
  name: string
  type: string
}

export default async function NewPlanPage() {
  const session = await requireFullSession('/app/financeiro/planos/new')

  // Lookup companies do tenant
  const client = await pool.connect()
  let companies: CompanyOption[] = []
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [
      session.logifit.tenantId,
    ])
    const r = await client.query<CompanyOption>(
      `SELECT c.id, c.name, c.type FROM companies c
       WHERE c.tenant_id = $1 AND c.archived_at IS NULL
       ORDER BY c.type, c.name`,
      [session.logifit.tenantId],
    )
    companies = r.rows
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href="/app/financeiro/planos"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Planos
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Novo plano</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Preço congelado por contrato — alterar plano não afeta contratos vigentes.
        </p>
      </header>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-center">
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Nenhuma empresa cadastrada.{' '}
            <Link
              href="/app/settings/empresas/new"
              className="font-medium text-[color:var(--ev-primary)]"
            >
              Cadastrar primeiro company →
            </Link>
          </p>
        </div>
      ) : (
        <NewPlanForm availableCompanies={companies} />
      )}
    </div>
  )
}
