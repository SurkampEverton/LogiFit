/**
 * `/app/fiscal` — Inbox de emissões fiscais (Sprint 36 Faixa C — backbone).
 *
 * MVP Sprint 36a: lista 100 últimas emissões com filtros (kind, status,
 * company). Botões de emissão contextualizados ainda em Sprint 36b
 * (precisa wizard onboarding + catálogo de serviços ativos).
 *
 * Sprint 36b adiciona:
 *   - Botões `[+ Emitir NFS-e]` / `[+ NF-e produto]` / `[+ NFC-e]` no header
 *   - Ações inline por linha (download PDF/XML, cancelar, CC-e, retry)
 *   - 4 KPIs no topo (emitidas mês / pendentes / rejected / cancelled)
 *   - Filtros adicionais (período, série, destinatário)
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { fiscalEmissions } from '@repo/db/schema'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  kind?: string
  status?: string
}

const KIND_LABEL: Record<string, string> = {
  nfse: 'NFS-e',
  nfe: 'NF-e',
  nfce: 'NFC-e',
  nfe_return: 'Devolução',
  nfe_transfer: 'Transferência',
  nfe_conserto_out: 'Conserto (saída)',
  nfe_conserto_return: 'Conserto (retorno)',
  nfe_self_entry: 'Entrada própria',
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: 'var(--ev-muted-bg, #e5e7eb)',
    fg: 'var(--ev-muted, #6b7280)',
    label: 'Rascunho',
  },
  queued: {
    bg: 'var(--ev-info-bg, #dbeafe)',
    fg: 'var(--ev-info, #1e40af)',
    label: 'Enviada',
  },
  processing: {
    bg: 'var(--ev-info-bg, #dbeafe)',
    fg: 'var(--ev-info, #1e40af)',
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

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatDateTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function FiscalInboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/fiscal')
  const tenantId = session.logifit.tenantId

  const where = [eq(fiscalEmissions.tenantId, tenantId)]
  if (params.kind) where.push(eq(fiscalEmissions.kind, params.kind as 'nfse'))
  if (params.status)
    where.push(eq(fiscalEmissions.status, params.status as 'draft'))

  const rows = await db
    .select({
      id: fiscalEmissions.id,
      kind: fiscalEmissions.kind,
      status: fiscalEmissions.status,
      provider: fiscalEmissions.provider,
      serie: fiscalEmissions.serie,
      numero: fiscalEmissions.numero,
      chave: fiscalEmissions.chave,
      valorTotalCents: fiscalEmissions.valorTotalCents,
      recipientName: fiscalEmissions.recipientName,
      recipientDocument: fiscalEmissions.recipientDocument,
      rejectionReason: fiscalEmissions.rejectionReason,
      retryCount: fiscalEmissions.retryCount,
      createdAt: fiscalEmissions.createdAt,
      completedAt: fiscalEmissions.completedAt,
    })
    .from(fiscalEmissions)
    .where(and(...where))
    .orderBy(desc(fiscalEmissions.createdAt))
    .limit(100)

  // KPIs simples
  const total = rows.length
  const autorizadas = rows.filter((r) => r.status === 'completed').length
  const pendentes = rows.filter((r) =>
    ['draft', 'queued', 'processing'].includes(r.status),
  ).length
  const rejeitadas = rows.filter((r) => r.status === 'rejected').length

  const totalAutorizadoCents = rows
    .filter((r) => r.status === 'completed')
    .reduce((s, r) => s + r.valorTotalCents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Emissões fiscais</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{total} últimas emissões</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/settings/fiscal" className="ev-btn ev-btn-ghost">
          ⚙ Configurações fiscais
        </Link>
      </header>

      {/* KPIs */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <KPI label="Autorizadas" value={String(autorizadas)} hint="status completed" />
        <KPI label="Pendentes" value={String(pendentes)} hint="draft + queued + processing" />
        <KPI
          label="Rejeitadas"
          value={String(rejeitadas)}
          hint="precisa intervenção"
          danger
        />
        <KPI
          label="Total autorizado"
          value={formatBrl(totalAutorizadoCents)}
          hint="soma valor das completed"
        />
      </section>

      {/* Filtros */}
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--ev-space-md)',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <label className="ev-stack-sm">
          <span style={{ color: 'var(--ev-muted)', fontSize: '0.875rem' }}>
            Tipo
          </span>
          <select name="kind" defaultValue={params.kind ?? ''} className="ev-input">
            <option value="">Todos</option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="ev-stack-sm">
          <span style={{ color: 'var(--ev-muted)', fontSize: '0.875rem' }}>
            Status
          </span>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            className="ev-input"
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_STYLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ev-btn ev-btn-primary">
          Filtrar
        </button>
        {(params.kind || params.status) && (
          <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
            Limpar
          </Link>
        )}
      </form>

      {/* Lista */}
      {rows.length === 0 ? (
        <div
          className="ev-card"
          style={{ padding: 'var(--ev-space-xl)', textAlign: 'center' }}
        >
          <p style={{ margin: 0, color: 'var(--ev-muted)' }}>
            Nenhuma emissão fiscal{params.kind || params.status ? ' com esses filtros' : ' ainda'}.
          </p>
          <p style={{ marginTop: 'var(--ev-space-md)', fontSize: '0.875rem' }}>
            Sprint 36b adiciona botões pra emissão contextual (NFS-e a partir de
            invoice paga, NF-e produto via POS, etc).
          </p>
        </div>
      ) : (
        <div className="ev-card">
          <table className="ev-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Série/Número</th>
                <th>Destinatário</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th>Status</th>
                <th>Criada em</th>
                <th>—</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.draft!
                return (
                  <tr key={row.id}>
                    <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                    <td>
                      {row.serie}/{row.numero}
                    </td>
                    <td>
                      <div>{row.recipientName ?? '—'}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--ev-muted)',
                        }}
                      >
                        {row.recipientDocument ?? ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatBrl(row.valorTotalCents)}
                    </td>
                    <td>
                      <span
                        className="ev-badge"
                        style={{
                          background: style.bg,
                          color: style.fg,
                        }}
                      >
                        {style.label}
                      </span>
                      {row.status === 'rejected' && row.rejectionReason && (
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--ev-danger, #dc2626)',
                            marginTop: '2px',
                          }}
                        >
                          {row.rejectionReason.slice(0, 60)}
                          {row.rejectionReason.length > 60 ? '…' : ''}
                          {row.retryCount > 0 && ` · retry ${row.retryCount}/3`}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td>
                      <Link
                        href={`/app/fiscal/${row.id}`}
                        className="ev-btn ev-btn-ghost ev-btn-sm"
                      >
                        Detalhe
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer
        style={{
          marginTop: 'var(--ev-space-lg)',
          fontSize: '0.75rem',
          color: 'var(--ev-muted)',
        }}
      >
        Sprint 36a backbone — provider mock; Sprint 36b conecta Focus NFe real
        + adiciona wizard de onboarding e ações inline (download PDF/XML,
        cancelar, CC-e, retry).
      </footer>
    </div>
  )
}

function KPI({
  label,
  value,
  hint,
  danger,
}: {
  label: string
  value: string
  hint?: string
  danger?: boolean
}) {
  return (
    <div
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        borderLeft: danger
          ? '4px solid var(--ev-danger, #dc2626)'
          : '4px solid var(--ev-primary, #2563eb)',
      }}
    >
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--ev-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          marginTop: 'var(--ev-space-xs)',
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '0.75rem', color: 'var(--ev-muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}
