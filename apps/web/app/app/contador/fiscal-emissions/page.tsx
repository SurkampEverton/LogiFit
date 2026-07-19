/**
 * `/app/contador/fiscal-emissions` — notas emitidas read-only (Sprint 36b.6, ADR 0061).
 *
 * Lista de `fiscal_emissions` por período/tipo/status com download individual
 * PDF/XML (route autenticada 36b.5 — contador tem `fiscal.read`). Sem ações
 * de escrita: cancelamento/CC-e são do operador, nunca do contador.
 */
import { db } from '@repo/db/client'
import { fiscalEmissions } from '@repo/db/schema'
import { and, desc, eq, gte } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

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

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  queued: 'Enviada',
  processing: 'Processando',
  completed: 'Autorizada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
}

const PERIOD_DAYS: Record<string, number> = { '30': 30, '90': 90, '365': 365 }

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ContadorFiscalEmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; period?: string }>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/contador/fiscal-emissions')
  const tenantId = session.logifit.tenantId

  const periodDays = PERIOD_DAYS[params.period ?? '90'] ?? 90
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

  const where = [eq(fiscalEmissions.tenantId, tenantId), gte(fiscalEmissions.createdAt, since)]
  if (params.kind && params.kind in KIND_LABEL)
    where.push(eq(fiscalEmissions.kind, params.kind as 'nfse'))
  if (params.status && params.status in STATUS_LABEL)
    where.push(eq(fiscalEmissions.status, params.status as 'completed'))

  const rows = await db
    .select({
      id: fiscalEmissions.id,
      kind: fiscalEmissions.kind,
      status: fiscalEmissions.status,
      serie: fiscalEmissions.serie,
      numero: fiscalEmissions.numero,
      chave: fiscalEmissions.chave,
      valorTotalCents: fiscalEmissions.valorTotalCents,
      recipientName: fiscalEmissions.recipientName,
      completedAt: fiscalEmissions.completedAt,
      createdAt: fiscalEmissions.createdAt,
      pdfStoragePath: fiscalEmissions.pdfStoragePath,
      xmlStoragePath: fiscalEmissions.xmlStoragePath,
    })
    .from(fiscalEmissions)
    .where(and(...where))
    .orderBy(desc(fiscalEmissions.createdAt))
    .limit(500)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Notas emitidas</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {rows.length} nota(s) · últimos {periodDays} dias
        </span>
      </header>

      <form method="get" className="ev-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="ev-stack-sm">
          <span style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
            Período
          </span>
          <select name="period" defaultValue={params.period ?? '90'} className="ev-input">
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="365">12 meses</option>
          </select>
        </label>
        <label className="ev-stack-sm">
          <span style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>Tipo</span>
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
          <span style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
            Status
          </span>
          <select name="status" defaultValue={params.status ?? ''} className="ev-input">
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ev-btn ev-btn-primary">
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--ev-text-muted)' }}>
            Nenhuma nota no período com esses filtros.
          </p>
        </div>
      ) : (
        <div className="ev-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ev-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Nº</th>
                <th>Destinatário</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Autorizada em</th>
                <th>Chave</th>
                <th>Arquivos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
                  <td className="num">
                    {row.serie}/{row.numero}
                  </td>
                  <td>{row.recipientName ?? '—'}</td>
                  <td className="num">{brl(row.valorTotalCents)}</td>
                  <td>{STATUS_LABEL[row.status] ?? row.status}</td>
                  <td className="num">
                    {row.completedAt ? row.completedAt.toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td>
                    <code style={{ fontSize: '0.7rem' }}>
                      {row.chave ? `${row.chave.slice(0, 10)}…` : '—'}
                    </code>
                  </td>
                  <td>
                    <span className="ev-row" style={{ gap: 'var(--ev-space-1)' }}>
                      {row.pdfStoragePath && (
                        <a
                          href={`/api/fiscal/emissions/${row.id}/pdf`}
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          download
                        >
                          PDF
                        </a>
                      )}
                      {row.xmlStoragePath && (
                        <a
                          href={`/api/fiscal/emissions/${row.id}/xml`}
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          download
                        >
                          XML
                        </a>
                      )}
                      {!row.pdfStoragePath && !row.xmlStoragePath && (
                        <span style={{ color: 'var(--ev-text-subtle)', fontSize: '0.75rem' }}>
                          —
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-xs)', margin: 0 }}>
        Download em massa (ZIP por período) chega na fase 2 do portal.{' '}
        <Link href="/app/contador">← Voltar à visão geral</Link>
      </p>
    </div>
  )
}
