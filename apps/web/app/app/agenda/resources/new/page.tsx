import { pool } from '@repo/db/client'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewResourceForm } from './new-resource-form'

export const dynamic = 'force-dynamic'

interface CompanyOption {
  id: string
  name: string
  type: string
}

export default async function NewResourcePage() {
  const session = await requireFullSession('/app/agenda/resources/new')

  // Lookup direto pelas companies do tenant (sem listCompanies action ainda)
  const client = await pool.connect()
  let companies: CompanyOption[] = []
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [session.logifit.tenantId])
    const r = await client.query<{ id: string; name: string; type: string }>(
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
          href="/app/agenda/resources"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Recursos
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Novo recurso</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Cadastre um instrutor, sala ou equipamento agendável.
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
        <NewResourceForm availableCompanies={companies} />
      )}
    </div>
  )
}
