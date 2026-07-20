/**
 * `/app/fiscal/emitir/nfse` — emissão de NFS-e avulsa (Sprint 36b.4, ADR 0059).
 *
 * Caso de uso primário: profissional Solo emitindo nota de consulta/sessão
 * avulsa sem invoice. Company + serviço vêm do catálogo fiscal; tomador é
 * digitado (person picker fica pro Sprint 36c).
 */
import { db } from '@repo/db/client'
import {
  companies,
  fiscalProviderCredentials,
  fiscalServiceCatalog,
  persons,
} from '@repo/db/schema'
import { Banner } from '@repo/ui'
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NfseManualForm } from './nfse-form'

export const dynamic = 'force-dynamic'

export default async function EmitirNfsePage() {
  const session = await requireFullSession('/app/fiscal/emitir/nfse')
  const tenantId = session.logifit.tenantId

  // Nada na tela distinguia emitir teste de emitir documento com efeito legal —
  // e um ambiente de dev apontado pra produção é uma armadilha silenciosa.
  const [creds] = await db
    .select({ environment: fiscalProviderCredentials.environment })
    .from(fiscalProviderCredentials)
    .where(
      and(
        eq(fiscalProviderCredentials.tenantId, tenantId),
        eq(fiscalProviderCredentials.provider, 'focus_nfe'),
        eq(fiscalProviderCredentials.active, true),
      ),
    )
    .limit(1)
  const isProducao = creds?.environment === 'producao'

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
      description: fiscalServiceCatalog.description,
      issRateBp: fiscalServiceCatalog.issRateBp,
      lc116Code: fiscalServiceCatalog.lc116Code,
    })
    .from(fiscalServiceCatalog)
    .where(and(eq(fiscalServiceCatalog.tenantId, tenantId), eq(fiscalServiceCatalog.active, true)))
    .orderBy(asc(fiscalServiceCatalog.description))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Emitir NFS-e avulsa</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
          ← Inbox de emissões
        </Link>
      </header>

      {isProducao && (
        <Banner variant="danger">
          <strong>Ambiente de produção.</strong> Toda emissão nesta tela gera um documento fiscal
          real, com efeito legal e tributário — não é teste. Confira valor, tomador e serviço antes
          de confirmar.
        </Banner>
      )}

      {services.length === 0 ? (
        <div
          className="ev-card"
          style={{
            borderLeft: '4px solid var(--ev-warning, #92400e)',
            padding: 'var(--ev-space-md)',
          }}
        >
          Nenhum serviço tributável ativo —{' '}
          <Link href="/app/settings/fiscal/catalogo" style={{ textDecoration: 'underline' }}>
            cadastre o catálogo
          </Link>{' '}
          antes de emitir.
        </div>
      ) : (
        <NfseManualForm
          companies={companyRows.map((c) => ({ id: c.id, name: `${c.name} (${c.type})` }))}
          services={services}
          isProducao={isProducao}
        />
      )}
    </div>
  )
}
