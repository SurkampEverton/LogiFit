/**
 * `/app/fisio/autorizacoes` — lista de autorizações (Sprint 22 Faixa C).
 */
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { authorizations, memberInsurances, persons, members } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  pending: { label: '⏳ Pendente', bg: 'var(--ev-warning-soft, #fef9c3)' },
  approved: { label: '✓ Aprovada', bg: 'var(--ev-success-soft, #dcfce7)' },
  denied: { label: '✗ Negada', bg: 'var(--ev-danger-soft, #fee2e2)' },
  expired: { label: '⏰ Expirada', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

export default async function AutorizacoesPage() {
  const session = await requireFullSession('/app/fisio/autorizacoes')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: authorizations.id,
      tussCode: authorizations.tussCode,
      quantityRequested: authorizations.quantityRequested,
      quantityAuthorized: authorizations.quantityAuthorized,
      quantityUsed: authorizations.quantityUsed,
      authorizationNumber: authorizations.authorizationNumber,
      status: authorizations.status,
      requestedAt: authorizations.requestedAt,
      validUntil: authorizations.validUntil,
      cardNumber: memberInsurances.cardNumber,
      memberName: persons.name,
    })
    .from(authorizations)
    .leftJoin(memberInsurances, eq(memberInsurances.id, authorizations.memberInsuranceId))
    .leftJoin(members, eq(members.id, memberInsurances.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(eq(authorizations.tenantId, tenantId))
    .orderBy(desc(authorizations.requestedAt))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Autorizações TISS</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} pedidos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/fisio/convenios" className="ev-btn ev-btn-ghost">
          ← Convênios
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Sprint 22 MVP: autorizações registradas manualmente após pedido à operadora.
          Sprint 22b automatiza via SOAP (ADR 0042) por provider.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma autorização registrada.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Paciente</th>
              <th>Carteirinha</th>
              <th>TUSS</th>
              <th>Qty (req/auth/usado)</th>
              <th>Senha</th>
              <th>Status</th>
              <th>Validade</th>
              <th>Pedido em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const badge = STATUS_BADGE[a.status] ?? { label: a.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={a.id}>
                  <td>{a.memberName ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.cardNumber}</td>
                  <td>
                    <code>{a.tussCode}</code>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {a.quantityRequested}/{a.quantityAuthorized ?? '?'}/{a.quantityUsed}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {a.authorizationNumber ?? '—'}
                  </td>
                  <td>
                    <span className="ev-badge" style={{ background: badge.bg }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.validUntil ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(a.requestedAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
