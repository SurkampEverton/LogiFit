/**
 * `/app/fiscal/devolucoes` — devoluções de compra (Sprint 17b, ADR 0104 + 0058).
 *
 * Lista `nfe_returns` com a chave da nota original e permite emitir a NF-e de
 * devolução (`finNFe=4` + `refNFe`). O cadastro completo (modal com seleção de
 * itens a partir da NF recebida) chega junto com a inbox do Sprint 17 — por
 * ora a devolução nasce por API/seed e esta tela cuida da emissão.
 */
import { db } from '@repo/db/client'
import { nfeReturns } from '@repo/db/schema'
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasPermission } from '../../../lib/permissions'
import { requireFullSession } from '../../../lib/session'
import { ReturnActions } from './actions-client'

export const dynamic = 'force-dynamic'

const REASON_LABEL: Record<string, string> = {
  defeito: 'Defeito',
  divergencia_quantidade: 'Divergência de quantidade',
  divergencia_especificacao: 'Divergência de especificação',
  atraso: 'Atraso',
  cancelamento: 'Cancelamento',
  outro: 'Outro',
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--ev-muted-bg)', fg: 'var(--ev-muted)', label: 'Rascunho' },
  emitted: { bg: 'var(--ev-success-bg)', fg: 'var(--ev-success)', label: 'Emitida' },
  cancelled: { bg: 'var(--ev-warning-bg)', fg: 'var(--ev-warning)', label: 'Cancelada' },
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function DevolucoesPage() {
  const session = await requireFullSession('/app/fiscal/devolucoes')
  if (!(await hasPermission(session.logifit.userId, 'fiscal.read'))) redirect('/app')

  const rows = await db
    .select()
    .from(nfeReturns)
    .where(eq(nfeReturns.tenantId, session.logifit.tenantId))
    .orderBy(desc(nfeReturns.createdAt))
    .limit(200)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Devoluções de compra</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>{rows.length} registro(s)</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
          ← Emissões
        </Link>
      </header>

      <p style={{ color: 'var(--ev-text-muted)' }}>
        A NF-e de devolução sai com <code>finNFe=4</code> referenciando a chave da nota original
        (ADR 0058). O cadastro pela inbox de NF-e recebidas chega no Sprint 17.
      </p>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--ev-text-muted)' }}>Nenhuma devolução registrada.</p>
        </div>
      ) : (
        <div className="ev-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ev-table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Chave original</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const st = STATUS_STYLE[row.status] ?? STATUS_STYLE.draft
                return (
                  <tr key={row.id}>
                    <td>
                      {row.originalSupplierName ?? '—'}
                      {row.originalSupplierDocument ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--ev-text-muted)' }}>
                          {row.originalSupplierDocument}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.7rem' }}>{row.originalChave.slice(0, 12)}…</code>
                    </td>
                    <td>{row.kind === 'total' ? 'Total' : 'Parcial'}</td>
                    <td>{REASON_LABEL[row.reasonCategory] ?? row.reasonCategory}</td>
                    <td className="num">{brl(row.returnAmountCents)}</td>
                    <td>
                      <span className="ev-badge" style={{ background: st?.bg, color: st?.fg }}>
                        {st?.label ?? row.status}
                      </span>
                    </td>
                    <td>
                      {row.status === 'draft' ? (
                        <ReturnActions nfeReturnId={row.id} />
                      ) : row.fiscalEmissionId ? (
                        <Link
                          href={`/app/fiscal/${row.fiscalEmissionId}`}
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                        >
                          Ver nota
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
