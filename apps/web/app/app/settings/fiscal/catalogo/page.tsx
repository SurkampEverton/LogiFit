/**
 * `/app/settings/fiscal/catalogo` — CRUD do catálogo de serviços tributáveis
 * (Sprint 36b.3, ADR 0059). Step 2 do wizard fiscal.
 *
 * Server Component carrega companies + catálogo; `<CatalogManager>` client
 * cuida de form + toggle (SAs gateadas fiscal.admin server-side).
 */
import { db } from '@repo/db/client'
import { companies, fiscalServiceCatalog, persons } from '@repo/db/schema'
import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { CatalogManager } from './catalog-client'

export const dynamic = 'force-dynamic'

export default async function FiscalCatalogPage() {
  const session = await requireFullSession('/app/settings/fiscal/catalogo')
  const tenantId = session.logifit.tenantId

  const companyRows = await db
    .select({ id: companies.id, name: persons.name, type: companies.type })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  const services = await db
    .select({
      id: fiscalServiceCatalog.id,
      companyId: fiscalServiceCatalog.companyId,
      municipalityCode: fiscalServiceCatalog.municipalityCode,
      lc116Code: fiscalServiceCatalog.lc116Code,
      codigoTributacaoNacional: fiscalServiceCatalog.codigoTributacaoNacional,
      cnae: fiscalServiceCatalog.cnae,
      description: fiscalServiceCatalog.description,
      taxRegime: fiscalServiceCatalog.taxRegime,
      issRateBp: fiscalServiceCatalog.issRateBp,
      active: fiscalServiceCatalog.active,
    })
    .from(fiscalServiceCatalog)
    .where(eq(fiscalServiceCatalog.tenantId, tenantId))
    .orderBy(asc(fiscalServiceCatalog.description))

  const companyNames = Object.fromEntries(companyRows.map((c) => [c.id, c.name]))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Catálogo de serviços tributáveis</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/settings/fiscal" className="ev-btn ev-btn-ghost">
          ← Configurações fiscais
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)' }}>
        Cada serviço define o município (código IBGE), item LC 116/2003, CNAE e alíquota ISS usados
        na emissão de NFS-e. A emissão usa o serviço escolhido pelo operador ou o primeiro ativo da
        empresa.
      </p>

      <CatalogManager
        companies={companyRows.map((c) => ({ id: c.id, name: `${c.name} (${c.type})` }))}
        services={services.map((s) => ({
          ...s,
          companyName: companyNames[s.companyId] ?? '—',
        }))}
      />
    </div>
  )
}
