/**
 * `/app/fiscal/[id]` — detalhe de emissão fiscal (Sprint 36b.2, ADR 0059).
 *
 * Read-only + ações inline via `<EmissionActions>` (cancelar/CC-e/retry/
 * re-consultar — MFA e feature flag gateados server-side nas SAs).
 */
import { findMunicipalityNfseProfile, isExternalPortalLink } from '@repo/ai'
import { db } from '@repo/db/client'
import { fiscalEmissions, fiscalEvents, fiscalServiceCatalog } from '@repo/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../lib/session'
import { EmissionActions } from './actions-client'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  nfse: 'NFS-e (serviço)',
  nfe: 'NF-e produto',
  nfce: 'NFC-e (varejo)',
  nfe_return: 'NF-e devolução',
  nfe_transfer: 'NF-e transferência',
  nfe_conserto_out: 'NF-e remessa conserto',
  nfe_conserto_return: 'NF-e retorno conserto',
  nfe_self_entry: 'NF-e entrada própria',
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--ev-muted-bg, #e5e7eb)', fg: 'var(--ev-muted, #6b7280)', label: 'Rascunho' },
  queued: { bg: 'var(--ev-info-bg, #dbeafe)', fg: 'var(--ev-info, #1d4ed8)', label: 'Na fila' },
  processing: {
    bg: 'var(--ev-info-bg, #dbeafe)',
    fg: 'var(--ev-info, #1d4ed8)',
    label: 'Processando',
  },
  completed: {
    bg: 'var(--ev-success-bg, #dcfce7)',
    fg: 'var(--ev-success, #16a34a)',
    label: 'Autorizada',
  },
  rejected: {
    bg: 'var(--ev-danger-bg, #fee2e2)',
    fg: 'var(--ev-danger, #dc2626)',
    label: 'Rejeitada',
  },
  cancelled: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Cancelada',
  },
}

function brl(cents: number | null): string {
  if (cents === null) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dt(value: Date | null): string {
  return value ? value.toLocaleString('pt-BR') : '—'
}

export default async function FiscalEmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/fiscal/${id}`)
  const tenantId = session.logifit.tenantId

  const [em] = await db
    .select()
    .from(fiscalEmissions)
    .where(and(eq(fiscalEmissions.id, id), eq(fiscalEmissions.tenantId, tenantId)))
    .limit(1)
  if (!em) notFound()

  // `sent` so existe em emissoes gravadas depois que o provider passou a
  // devolver o corpo transmitido; emissoes antigas seguem sem ele.
  const sentPayload =
    em.payload && typeof em.payload === 'object'
      ? ((em.payload as Record<string, unknown>).sent ?? null)
      : null

  const events = await db
    .select({
      id: fiscalEvents.id,
      kind: fiscalEvents.kind,
      status: fiscalEvents.status,
      justification: fiscalEvents.justification,
      createdAt: fiscalEvents.createdAt,
    })
    .from(fiscalEvents)
    .where(and(eq(fiscalEvents.emissionId, em.id), eq(fiscalEvents.tenantId, tenantId)))
    .orderBy(desc(fiscalEvents.createdAt))
    .limit(50)

  const status = STATUS_STYLE[em.status] ?? STATUS_STYLE.draft
  const cancelWindowOpen =
    em.status === 'completed' && (!em.cancelDeadlineAt || em.cancelDeadlineAt > new Date())
  const canRetry = em.status === 'rejected' && em.retryCount < 3

  // Algumas prefeituras não expõem cancelamento por webservice — nesses casos o
  // cancelamento acontece no portal e NÃO propaga de volta pra Focus. O botão
  // continua disponível, mas vira "registrar cancelamento" (baixa manual, com
  // aviso), em vez de disparar um webservice que não existe.
  let cancelWarning: string | null = null
  let webserviceCancel = true
  if (em.kind === 'nfse' && cancelWindowOpen) {
    const [svc] = await db
      .select({ municipalityCode: fiscalServiceCatalog.municipalityCode })
      .from(fiscalServiceCatalog)
      .where(
        and(
          eq(fiscalServiceCatalog.tenantId, tenantId),
          eq(fiscalServiceCatalog.companyId, em.companyId),
          eq(fiscalServiceCatalog.active, true),
        ),
      )
      .limit(1)
    const profile = findMunicipalityNfseProfile(svc?.municipalityCode)
    if (profile && !profile.supportsWebserviceCancel) {
      webserviceCancel = false
      cancelWarning = [
        `A prefeitura de ${profile.name}/${profile.uf} não cancela NFS-e por webservice.`,
        `Cancele primeiro no portal do município (${profile.system}), com o mesmo login usado`,
        'para emitir. Confirmar aqui apenas registra essa baixa no sistema — não cancela pela',
        'prefeitura.',
      ].join(' ')
    }
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>
          {KIND_LABEL[em.kind] ?? em.kind}
          {em.numeroDocumento ? (
            // Numeracao da autoridade quando ja atribuida; o RPS vira detalhe.
            <>
              {' '}
              {em.serieDocumento ? `· série ${em.serieDocumento} ` : '· '}nº {em.numeroDocumento}
            </>
          ) : (
            <>
              {' '}
              · RPS série {em.serie} nº {em.numero}
            </>
          )}
        </h1>
        <span className="ev-badge" style={{ background: status?.bg, color: status?.fg }}>
          {status?.label ?? em.status}
        </span>
        <span style={{ flex: 1 }} />
        {em.pdfStoragePath &&
          (isExternalPortalLink(em.pdfStoragePath) ? (
            // Cascavel e afins nao entregam arquivo: a nota vive no portal do
            // municipio e a pagina exige a sessao do contribuinte. Um botao de
            // download aqui so produz 404.
            <a
              href={em.pdfStoragePath}
              className="ev-btn ev-btn-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              ↗ Ver nota no portal
            </a>
          ) : (
            <a href={`/api/fiscal/emissions/${em.id}/pdf`} className="ev-btn ev-btn-sm" download>
              ⬇ PDF
            </a>
          ))}
        {em.xmlStoragePath && (
          <a href={`/api/fiscal/emissions/${em.id}/xml`} className="ev-btn ev-btn-sm" download>
            ⬇ XML
          </a>
        )}
        <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
          ← Inbox de emissões
        </Link>
      </header>

      {em.status === 'rejected' && em.rejectionReason && (
        <div
          className="ev-card"
          role="alert"
          style={{
            borderLeft: '4px solid var(--ev-danger, #dc2626)',
            padding: 'var(--ev-space-md)',
          }}
        >
          <strong>Motivo da rejeição:</strong> {em.rejectionReason}
          {canRetry && (
            <span style={{ color: 'var(--ev-text-muted)' }}> · tentativa {em.retryCount}/3</span>
          )}
        </div>
      )}

      {sentPayload && (
        <details className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          {/* O motivo devolvido pelo municipio so e interpretavel ao lado do
              que foi transmitido — "codigo do item da lista de servico
              preenchido incorretamente" nao diz QUAL codigo saiu. */}
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Payload enviado ao provider
          </summary>
          <pre
            style={{
              marginTop: 'var(--ev-space-sm)',
              marginBottom: 0,
              overflowX: 'auto',
              fontSize: '0.8125rem',
              color: 'var(--ev-text-muted)',
            }}
          >
            {JSON.stringify(sentPayload, null, 2)}
          </pre>
        </details>
      )}

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Dados da emissão</h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(10rem, max-content) 1fr',
            gap: '0.35rem 1rem',
            margin: 0,
          }}
        >
          <dt style={{ color: 'var(--ev-text-muted)' }}>RPS</dt>
          <dd style={{ margin: 0 }}>
            série {em.serie} nº {em.numero}
            {em.numeroDocumento && (
              <span style={{ color: 'var(--ev-text-muted)' }}>
                {' '}
                — numeração que enviamos; a nota recebeu outra do município
              </span>
            )}
          </dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Valor total</dt>
          <dd style={{ margin: 0, fontWeight: 600 }}>{brl(em.valorTotalCents)}</dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Destinatário</dt>
          <dd style={{ margin: 0 }}>
            {em.recipientName ?? '—'}
            {em.recipientDocument ? ` · ${em.recipientDocument}` : ''}
          </dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Chave</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{em.chave ?? '—'}</code>
          </dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Ref no provider</dt>
          <dd style={{ margin: 0 }}>
            <code style={{ fontSize: '0.8rem' }}>{em.providerRef ?? '—'}</code> ({em.provider})
          </dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Origem</dt>
          <dd style={{ margin: 0 }}>
            {em.sourceKind ?? 'manual'}
            {em.sourceId ? ` · ${em.sourceId.slice(0, 8)}` : ''}
          </dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Enviada em</dt>
          <dd style={{ margin: 0 }}>{dt(em.submittedAt)}</dd>
          <dt style={{ color: 'var(--ev-text-muted)' }}>Autorizada em</dt>
          <dd style={{ margin: 0 }}>{dt(em.completedAt)}</dd>
          {em.cancelledAt && (
            <>
              <dt style={{ color: 'var(--ev-text-muted)' }}>Cancelada em</dt>
              <dd style={{ margin: 0 }}>{dt(em.cancelledAt)}</dd>
            </>
          )}
          {em.status === 'completed' && (
            <>
              <dt style={{ color: 'var(--ev-text-muted)' }}>Janela de cancelamento</dt>
              <dd style={{ margin: 0 }}>
                {/* Sem prazo gravado nao significa "expirada" — significa que a
                    regra e do municipio e nao a conhecemos. Dizer "expirada"
                    faria o operador desistir de um cancelamento possivel. */}
                {em.cancelDeadlineAt
                  ? cancelWindowOpen
                    ? `até ${dt(em.cancelDeadlineAt)}`
                    : 'expirada'
                  : 'definida pelo município — consulte o portal da prefeitura'}
              </dd>
            </>
          )}
        </dl>
      </section>

      <EmissionActions
        emissionId={em.id}
        status={em.status}
        kind={em.kind}
        cancelWindowOpen={cancelWindowOpen}
        webserviceCancel={webserviceCancel}
        cancelWarning={cancelWarning}
        canRetry={canRetry}
        hasProviderRef={em.providerRef !== null}
      />

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Eventos fiscais</h2>
        {events.length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
            Nenhum evento (cancelamento, CC-e) registrado.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {events.map((ev) => (
              <li key={ev.id} style={{ marginBottom: '0.35rem' }}>
                <strong>{ev.kind}</strong> · {ev.status} · {dt(ev.createdAt)}
                {ev.justification && (
                  <span style={{ color: 'var(--ev-text-muted)' }}> — {ev.justification}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
