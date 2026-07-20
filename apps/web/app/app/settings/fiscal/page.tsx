import { findMunicipalityNfseProfile } from '@repo/ai'
import { db } from '@repo/db/client'
import {
  companies,
  fiscalNumberingSequences,
  fiscalProviderCredentials,
  fiscalServiceCatalog,
  persons,
} from '@repo/db/schema'
/**
 * `/app/settings/fiscal` — Wizard onboarding fiscal (Sprint 36 Faixa C — esqueleto).
 *
 * **Sprint 36a backbone:** apenas exibe o estado atual (credentials configuradas?
 * regime tributário definido? catálogo populado?). Sprint 36b implementa:
 *   - Step 1: cadastrar credentials Focus (cifra AES-256-GCM via KEK por tenant)
 *   - Step 2: escolher regime tributário (Simples Nacional / Lucro Presumido / Lucro Real / MEI)
 *   - Step 3: catálogo de serviços (LC 116/2003 + alíquota ISS por município)
 *   - Step 4: séries e numeração inicial por tipo
 *   - Step 5: teste de emissão homologação (mock data com 1 NFS-e fake)
 */
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { FiscalCredentialsForm } from './credentials-form'
import { type MunicipalCompanyOption, MunicipalCredentialsForm } from './municipal-credentials-form'

export const dynamic = 'force-dynamic'

export default async function FiscalSettingsPage() {
  const session = await requireFullSession('/app/settings/fiscal')
  const tenantId = session.logifit.tenantId

  const credentials = await db
    .select({
      provider: fiscalProviderCredentials.provider,
      environment: fiscalProviderCredentials.environment,
      lastValidatedAt: fiscalProviderCredentials.lastValidatedAt,
      lastValidationStatus: fiscalProviderCredentials.lastValidationStatus,
      active: fiscalProviderCredentials.active,
    })
    .from(fiscalProviderCredentials)
    .where(eq(fiscalProviderCredentials.tenantId, tenantId))

  const services = await db
    .select({ id: fiscalServiceCatalog.id, active: fiscalServiceCatalog.active })
    .from(fiscalServiceCatalog)
    .where(eq(fiscalServiceCatalog.tenantId, tenantId))

  const numbering = await db
    .select({
      kind: fiscalNumberingSequences.kind,
      serie: fiscalNumberingSequences.serie,
      nextNumero: fiscalNumberingSequences.nextNumero,
      environment: fiscalNumberingSequences.environment,
    })
    .from(fiscalNumberingSequences)
    .where(eq(fiscalNumberingSequences.tenantId, tenantId))

  // Companies com catálogo: só elas emitem NFS-e, e o município do catálogo é
  // que diz qual série o portal espera (perfis em @repo/ai — ADR 0105).
  const companyRows = await db
    .select({
      id: companies.id,
      name: persons.name,
      type: companies.type,
      configuredAt: companies.municipalCredentialsConfiguredAt,
      municipalityCode: fiscalServiceCatalog.municipalityCode,
    })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .innerJoin(
      fiscalServiceCatalog,
      and(eq(fiscalServiceCatalog.companyId, companies.id), eq(fiscalServiceCatalog.active, true)),
    )
    .where(eq(companies.tenantId, tenantId))
    .orderBy(persons.name)

  const municipalCompanies: MunicipalCompanyOption[] = []
  for (const row of companyRows) {
    if (municipalCompanies.some((c) => c.id === row.id)) continue // 1 linha por company
    const profile = findMunicipalityNfseProfile(row.municipalityCode)
    municipalCompanies.push({
      id: row.id,
      name: `${row.name} (${row.type})`,
      suggestedSerie: profile?.defaultRpsSerie ?? null,
      municipalityLabel: profile ? `${profile.name}/${profile.uf} · ${profile.system}` : null,
      configuredAt: row.configuredAt?.toLocaleDateString('pt-BR') ?? null,
    })
  }

  const credentialsOk = credentials.some((c) => c.active)
  const servicesOk = services.some((s) => s.active)
  const numberingOk = numbering.length > 0

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
        }}
      >
        <h1 style={{ margin: 0 }}>Configurações fiscais</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
          ← Voltar para emissões
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)' }}>
        Configure o provider Focus NFe e o catálogo de serviços tributáveis antes de emitir notas
        fiscais. Sem credenciais salvas, emissões em dev/teste usam o provider mock; produção exige
        credenciais ativas.
      </p>

      <Step
        index={1}
        title="Credentials Focus NFe"
        done={credentialsOk}
        body={
          <>
            {credentialsOk && (
              <div style={{ marginBottom: 'var(--ev-space-sm)' }}>
                {credentials.map((c) => (
                  <div key={`${c.provider}-${c.environment}`}>
                    <strong>{c.provider}</strong> · {c.environment}{' '}
                    <span style={{ color: 'var(--ev-muted)', fontSize: '0.875rem' }}>
                      · validado: {c.lastValidatedAt?.toLocaleString('pt-BR') ?? 'nunca'} ·{' '}
                      {c.lastValidationStatus ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <FiscalCredentialsForm configured={credentialsOk} />
          </>
        }
      />

      {credentialsOk && municipalCompanies.length > 0 && (
        <Step
          index={1.5}
          title="Credenciais do portal municipal"
          done={municipalCompanies.some((c) => c.configuredAt !== null)}
          body={<MunicipalCredentialsForm companies={municipalCompanies} />}
        />
      )}

      <Step
        index={2}
        title="Catálogo de serviços tributáveis"
        done={servicesOk}
        body={
          <>
            {servicesOk ? (
              <p style={{ marginTop: 0 }}>
                {services.filter((s) => s.active).length} serviço(s) ativo(s) cadastrado(s).
              </p>
            ) : (
              <p style={{ marginTop: 0 }}>
                Cadastre os serviços que sua empresa presta (mensalidade academia, consulta fisio,
                sessão pilates) com código LC 116/2003 + alíquota ISS do município.
              </p>
            )}
            <Link href="/app/settings/fiscal/catalogo" className="ev-btn ev-btn-sm">
              {servicesOk ? 'Gerenciar catálogo' : 'Cadastrar serviços'}
            </Link>
          </>
        }
      />

      <Step
        index={3}
        title="Séries e numeração"
        done={numberingOk}
        body={
          numberingOk ? (
            <>
              {numbering.map((n) => (
                <div key={`${n.kind}-${n.serie}-${n.environment}`}>
                  <strong>{n.kind}</strong> série {n.serie} · próximo nº: {n.nextNumero} ·{' '}
                  {n.environment}
                </div>
              ))}
            </>
          ) : (
            <>
              Séries serão criadas automaticamente na primeira emissão por
              <code> (company × kind × serie × environment)</code>. Numeração começa em 1.
            </>
          )
        }
      />

      <Step
        index={4}
        title="Teste de emissão (homologação)"
        done={false}
        body={
          <>
            Sprint 36b adiciona botão pra emitir 1 NFS-e fake em ambiente homologação Focus NFe (sem
            custo SEFAZ; valida fluxo end-to-end).
          </>
        }
      />
    </div>
  )
}

function Step({
  index,
  title,
  done,
  body,
}: {
  index: number
  title: string
  done: boolean
  body: React.ReactNode
}) {
  return (
    <div
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        borderLeft: done
          ? '4px solid var(--ev-success, #16a34a)'
          : '4px solid var(--ev-muted, #6b7280)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-sm)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            minWidth: '1.75rem',
            height: '1.75rem',
            borderRadius: '50%',
            background: done ? 'var(--ev-success, #16a34a)' : 'var(--ev-muted-bg, #e5e7eb)',
            // design-token-exempt: #fff pra contraste sobre success bg quando done
            color: done ? '#fff' : 'var(--ev-muted, #6b7280)',
            textAlign: 'center',
            lineHeight: '1.75rem',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {done ? '✓' : index}
        </span>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {done && (
          <span
            className="ev-badge"
            style={{
              background: 'var(--ev-success-bg, #dcfce7)',
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            Configurado
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 'var(--ev-space-sm)',
          marginLeft: '2.25rem',
          color: 'var(--ev-fg)',
        }}
      >
        {body}
      </div>
    </div>
  )
}
