/**
 * `/app/financeiro/fornecedores` — lista de fornecedores (Sprint 15 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { persons, suppliers } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatDoc(doc: string | null, kind: string): string {
  if (!doc) return '—'
  if (kind === 'pf' && doc.length === 11) {
    return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9, 11)}`
  }
  if (kind === 'pj' && doc.length === 14) {
    return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12, 14)}`
  }
  return doc
}

export default async function FornecedoresListPage() {
  const session = await requireFullSession('/app/financeiro/fornecedores')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: suppliers.id,
      personId: suppliers.personId,
      companyId: suppliers.companyId,
      defaultPaymentMethod: suppliers.defaultPaymentMethod,
      defaultPaymentTermDays: suppliers.defaultPaymentTermDays,
      notes: suppliers.notes,
      archivedAt: suppliers.archivedAt,
      createdAt: suppliers.createdAt,
      personName: persons.name,
      personDocument: persons.document,
      personKind: persons.kind,
      personEmail: persons.email,
      personPhone: persons.phone,
    })
    .from(suppliers)
    .leftJoin(persons, eq(persons.id, suppliers.personId))
    .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.archivedAt)))
    .orderBy(asc(persons.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Fornecedores</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} ativos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/fornecedores/new" className="ev-btn ev-btn-primary">
          + Adicionar fornecedor
        </Link>
      </header>

      {rows.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhum fornecedor cadastrado ainda. Cadastre o primeiro fornecedor para começar a lançar
            contas a pagar com vínculo.
          </p>
          <Link href="/app/financeiro/fornecedores/new" className="ev-btn ev-btn-primary">
            Adicionar fornecedor
          </Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Nome</th>
                <th style={{ textAlign: 'left' }}>Documento</th>
                <th style={{ textAlign: 'left' }}>Contato</th>
                <th style={{ textAlign: 'left' }}>Pagamento padrão</th>
                <th style={{ textAlign: 'right' }}>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/app/financeiro/fornecedores/${row.id}`}>
                      {row.personName ?? '—'}
                    </Link>
                  </td>
                  <td>
                    <code style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {formatDoc(row.personDocument, row.personKind ?? 'pj')}
                    </code>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-sm)' }}>
                    {row.personEmail ?? row.personPhone ?? '—'}
                  </td>
                  <td>
                    {row.defaultPaymentMethod ? (
                      <span className="ev-badge">{row.defaultPaymentMethod.toUpperCase()}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {row.defaultPaymentTermDays != null ? `D+${row.defaultPaymentTermDays}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
