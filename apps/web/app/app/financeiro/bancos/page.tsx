import { db } from '@repo/db/client'
import { bankAccounts, companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/bancos` — lista de contas bancárias (Sprint 17 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  checking: 'CC',
  savings: 'Poupança',
  business: 'CC PJ',
  cashbox: 'Caixa',
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function BancosListPage() {
  const session = await requireFullSession('/app/financeiro/bancos')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: bankAccounts.id,
      companyId: bankAccounts.companyId,
      bankCode: bankAccounts.bankCode,
      bankName: bankAccounts.bankName,
      agency: bankAccounts.agency,
      accountNumber: bankAccounts.accountNumber,
      accountDigit: bankAccounts.accountDigit,
      kind: bankAccounts.kind,
      nickname: bankAccounts.nickname,
      currentBalanceCents: bankAccounts.currentBalanceCents,
      lastSyncedAt: bankAccounts.lastSyncedAt,
      openfinanceConnectionId: bankAccounts.openfinanceConnectionId,
      companyName: persons.name,
    })
    .from(bankAccounts)
    .leftJoin(companies, eq(companies.id, bankAccounts.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(and(eq(bankAccounts.tenantId, tenantId), isNull(bankAccounts.archivedAt)))
    .orderBy(asc(bankAccounts.bankName))

  const totalBalance = rows.reduce((s, r) => s + r.currentBalanceCents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Bancos</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} contas ativas</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/fluxo-caixa" className="ev-btn ev-btn-ghost">
          Fluxo de caixa
        </Link>
        <Link href="/app/financeiro/conciliacao/regras" className="ev-btn ev-btn-ghost">
          Regras conciliação
        </Link>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/bancos/new" className="ev-btn ev-btn-primary">
          + Nova conta
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
          Saldo consolidado
        </div>
        <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
          {formatBrl(totalBalance)}
        </div>
      </div>

      {rows.length === 0 && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma conta bancária cadastrada. Adicione a primeira pra começar a importar extratos
            (OFX) e conciliar com AP/AR.
          </p>
          <Link href="/app/financeiro/bancos/new" className="ev-btn ev-btn-primary">
            Adicionar conta
          </Link>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        {rows.map((acc) => (
          <Link
            key={acc.id}
            href={`/app/financeiro/bancos/${acc.id}/extrato`}
            className="ev-card"
            style={{
              padding: 'var(--ev-space-md)',
              textDecoration: 'none',
              color: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <strong>{acc.nickname ?? acc.bankName}</strong>
              <span style={{ flex: 1 }} />
              <span className="ev-badge">{KIND_LABELS[acc.kind] ?? acc.kind}</span>
            </div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              {acc.bankCode} · {acc.bankName} · {acc.agency ? `Ag ${acc.agency}` : ''}{' '}
              {acc.accountNumber}
              {acc.accountDigit ? `-${acc.accountDigit}` : ''}
            </div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              {acc.companyName ?? '—'}
            </div>
            <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600, marginTop: 4 }}>
              {formatBrl(acc.currentBalanceCents)}
            </div>
            <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
              {acc.lastSyncedAt
                ? `Sync ${new Date(acc.lastSyncedAt).toLocaleString('pt-BR')}`
                : 'Nunca sincronizado'}
              {acc.openfinanceConnectionId && (
                <>
                  {' '}
                  · <span style={{ color: 'var(--ev-success, #16a34a)' }}>Open Finance ✓</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
