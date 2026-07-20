import { db } from '@repo/db/client'
import { companies, leadStages, persons } from '@repo/db/schema'
/**
 * `/app/vendas/leads/new` — formulário rápido de captura de lead.
 *
 * Captura mínima sem person_id (apenas quick_name/quick_phone/quick_email).
 * `upgradeLeadToPerson` ficará Faixa D+ quando avançar pra estágio proposta.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewLeadForm } from './new-lead-form'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
  const session = await requireFullSession('/app/vendas/leads/new')
  const tenantId = session.logifit.tenantId

  const [companiesRows, stagesRows] = await Promise.all([
    db
      .select({ id: companies.id, name: persons.name })
      .from(companies)
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(eq(companies.tenantId, tenantId))
      .orderBy(asc(persons.name)),
    db
      .select({
        id: leadStages.id,
        slug: leadStages.slug,
        name: leadStages.name,
        orderIdx: leadStages.orderIdx,
      })
      .from(leadStages)
      .where(and(eq(leadStages.tenantId, tenantId), eq(leadStages.active, true)))
      .orderBy(asc(leadStages.orderIdx)),
  ])

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo lead</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Captura rápida — basta nome ou telefone pra começar.
          </p>
        </div>
        <Link
          href="/app/vendas"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewLeadForm companies={companiesRows} stages={stagesRows} />
    </div>
  )
}
