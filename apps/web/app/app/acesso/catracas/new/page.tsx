/**
 * `/app/acesso/catracas/new` — wizard cadastro catraca (Sprint 08 Faixa C).
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'
import { NewCatracaForm } from './new-catraca-form'

export const dynamic = 'force-dynamic'

interface CompanyOption {
  id: string
  name: string
  type: string
}
interface UnitOption {
  id: string
  name: string
  companyId: string
}

export default async function NewCatracaPage() {
  const session = await requireFullSession('/app/acesso/catracas/new')

  const client = await pool.connect()
  let companies: CompanyOption[] = []
  let unitsList: UnitOption[] = []
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [
      session.logifit.tenantId,
    ])
    const cRes = await client.query<CompanyOption>(
      `SELECT c.id, c.name, c.type FROM companies c
       WHERE c.tenant_id = $1 AND c.archived_at IS NULL
       ORDER BY c.type, c.name`,
      [session.logifit.tenantId],
    )
    companies = cRes.rows
    const uRes = await client.query<UnitOption>(
      `SELECT u.id, u.name, u.company_id as "companyId" FROM units u
       WHERE u.tenant_id = $1
       ORDER BY u.name`,
      [session.logifit.tenantId],
    )
    unitsList = uRes.rows
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href="/app/acesso/catracas"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Catracas
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Cadastrar catraca</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Após cadastrar, copie o token gerado — só aparece 1× (hash bcrypt fica no banco).
          Catraca usa o token em header `x-device-token` para autenticar `/api/acesso/checkin`.
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
        <NewCatracaForm availableCompanies={companies} availableUnits={unitsList} />
      )}
    </div>
  )
}
