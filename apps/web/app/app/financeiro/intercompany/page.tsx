import { db } from '@repo/db/client'
import { companies, intercompanyEntries, persons, tenants } from '@repo/db/schema'
/**
 * `/app/financeiro/intercompany` — dashboard intercompany com matriz from×to (Sprint 16 Faixa C).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  payment: { bg: 'var(--ev-info-bg, #dbeafe)', fg: 'var(--ev-info, #1e40af)', label: 'Pagamento' },
  transfer: {
    bg: 'var(--ev-info-bg, #dbeafe)',
    fg: 'var(--ev-info, #1e40af)',
    label: 'Transferência',
  },
  service: {
    bg: 'var(--ev-success-bg, #dcfce7)',
    fg: 'var(--ev-success, #16a34a)',
    label: 'Serviço',
  },
  goods: {
    bg: 'var(--ev-warning-bg, #fef3c7)',
    fg: 'var(--ev-warning, #92400e)',
    label: 'Bens (NF-e)',
  },
  adjustment: {
    bg: 'var(--ev-muted-bg, #e5e7eb)',
    fg: 'var(--ev-muted, #6b7280)',
    label: 'Ajuste',
  },
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function IntercompanyPage() {
  const session = await requireFullSession('/app/financeiro/intercompany')
  const tenantId = session.logifit.tenantId

  const [tenant] = await db
    .select({ topology: tenants.topology })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const isOwned = tenant?.topology === 'owned'

  // Lista companies pra resolver nomes
  const compRows = await db
    .select({ id: companies.id, name: persons.name, type: companies.type })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
  const nameById = new Map(compRows.map((c) => [c.id, c.name ?? '—']))

  // Saldos pendentes (sem settled_at) agrupados por par
  const balances = await db
    .select({
      fromCompanyId: intercompanyEntries.fromCompanyId,
      toCompanyId: intercompanyEntries.toCompanyId,
      pendingCents: sql<number>`SUM(${intercompanyEntries.amountCents})::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(intercompanyEntries)
    .where(and(eq(intercompanyEntries.tenantId, tenantId), isNull(intercompanyEntries.settledAt)))
    .groupBy(intercompanyEntries.fromCompanyId, intercompanyEntries.toCompanyId)
    .orderBy(desc(sql`SUM(${intercompanyEntries.amountCents})`))

  // Últimas 50 entries
  const recentEntries = await db
    .select({
      id: intercompanyEntries.id,
      fromCompanyId: intercompanyEntries.fromCompanyId,
      toCompanyId: intercompanyEntries.toCompanyId,
      amountCents: intercompanyEntries.amountCents,
      kind: intercompanyEntries.kind,
      settledAt: intercompanyEntries.settledAt,
      settlementMethod: intercompanyEntries.settlementMethod,
      requiresNfeTransfer: intercompanyEntries.requiresNfeTransfer,
      nfeTransferEmissionId: intercompanyEntries.nfeTransferEmissionId,
      notes: intercompanyEntries.notes,
      createdAt: intercompanyEntries.createdAt,
    })
    .from(intercompanyEntries)
    .where(eq(intercompanyEntries.tenantId, tenantId))
    .orderBy(desc(intercompanyEntries.createdAt))
    .limit(50)

  const totalPending = balances.reduce((s, b) => s + Number(b.pendingCents), 0)
  const nfeAlerts = recentEntries.filter(
    (e) => e.requiresNfeTransfer && !e.nfeTransferEmissionId && !e.settledAt,
  )

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Intercompany</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/intercompany/fechamento" className="ev-btn ev-btn-ghost">
          Fechamento mensal
        </Link>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        {isOwned && (
          <Link href="/app/financeiro/intercompany/new" className="ev-btn ev-btn-primary">
            + Novo lançamento IC
          </Link>
        )}
      </header>

      {!isOwned && (
        <div
          className="ev-alert ev-alert-warning"
          role="alert"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>Intercompany indisponível</strong> — topology={tenant?.topology}. Apenas{' '}
          <code>owned</code> permite IC (regra 25).
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Saldo pendente total
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(totalPending)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Pares pendentes
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{balances.length}</div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            NF-e transferência pendente
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: nfeAlerts.length > 0 ? 'var(--ev-warning, #92400e)' : 'inherit',
            }}
          >
            {nfeAlerts.length}
          </div>
        </div>
      </div>

      {nfeAlerts.length > 0 && (
        <section
          className="ev-alert ev-alert-warning"
          style={{ padding: 'var(--ev-space-md)' }}
          role="alert"
        >
          <strong>⚠ Transferências de bens cruzam CNPJs</strong> — {nfeAlerts.length} entries
          requerem NF-e de transferência. Sprint 36 (Focus NFe) ativa emissão direta; até lá, emita
          NF-e externa e registre a chave manualmente.
        </section>
      )}

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <header
          style={{
            padding: 'var(--ev-space-md)',
            borderBottom: '1px solid var(--ev-border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Saldos pendentes por par</h2>
        </header>
        {balances.length === 0 ? (
          <p style={{ padding: 'var(--ev-space-md)', margin: 0, color: 'var(--ev-muted)' }}>
            Nenhum saldo intercompany pendente.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>De</th>
                <th></th>
                <th style={{ textAlign: 'left' }}>Para</th>
                <th style={{ textAlign: 'right' }}>Entries</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={`${b.fromCompanyId}-${b.toCompanyId}`}>
                  <td>{nameById.get(b.fromCompanyId) ?? '—'}</td>
                  <td style={{ textAlign: 'center', color: 'var(--ev-muted)' }}>→</td>
                  <td>{nameById.get(b.toCompanyId) ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{b.count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(Number(b.pendingCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <header
          style={{ padding: 'var(--ev-space-md)', borderBottom: '1px solid var(--ev-border)' }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Lançamentos recentes</h2>
        </header>
        {recentEntries.length === 0 ? (
          <p style={{ padding: 'var(--ev-space-md)', margin: 0, color: 'var(--ev-muted)' }}>
            Nenhum lançamento intercompany.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Tipo</th>
                <th style={{ textAlign: 'left' }}>De</th>
                <th style={{ textAlign: 'left' }}>Para</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.map((e) => {
                const badge = KIND_BADGE[e.kind]!
                const settled = e.settledAt !== null
                return (
                  <tr key={e.id}>
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {new Date(e.createdAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <span
                        className="ev-badge"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                      {e.requiresNfeTransfer && !e.nfeTransferEmissionId && (
                        <span
                          style={{ marginLeft: 4, fontSize: 'var(--ev-font-xs)' }}
                          title="Requer NF-e"
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td>{nameById.get(e.fromCompanyId) ?? '—'}</td>
                    <td>{nameById.get(e.toCompanyId) ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatBrl(e.amountCents)}</td>
                    <td>
                      {settled ? (
                        <span
                          className="ev-badge"
                          style={{
                            backgroundColor: 'var(--ev-success-bg, #dcfce7)',
                            color: 'var(--ev-success, #16a34a)',
                          }}
                        >
                          Liquidado {e.settlementMethod ? `(${e.settlementMethod})` : ''}
                        </span>
                      ) : (
                        <span className="ev-badge">Pendente</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
