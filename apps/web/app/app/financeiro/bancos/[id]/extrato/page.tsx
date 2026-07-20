import { db } from '@repo/db/client'
import {
  accountsPayable,
  accountsReceivable,
  bankAccounts,
  bankTransactions,
} from '@repo/db/schema'
/**
 * `/app/financeiro/bancos/[id]/extrato` — extrato bancário (Sprint 17 Faixa C).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'
import { OfxImportForm } from './ofx-import-form'

export const dynamic = 'force-dynamic'

interface SearchParams {
  reconciled?: 'yes' | 'no' | 'all'
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function ExtratoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const session = await requireFullSession(`/app/financeiro/bancos/${id}/extrato`)
  const tenantId = session.logifit.tenantId

  const [account] = await db
    .select({
      id: bankAccounts.id,
      bankCode: bankAccounts.bankCode,
      bankName: bankAccounts.bankName,
      agency: bankAccounts.agency,
      accountNumber: bankAccounts.accountNumber,
      accountDigit: bankAccounts.accountDigit,
      kind: bankAccounts.kind,
      nickname: bankAccounts.nickname,
      currentBalanceCents: bankAccounts.currentBalanceCents,
      lastSyncedAt: bankAccounts.lastSyncedAt,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.tenantId, tenantId)))
    .limit(1)

  if (!account) notFound()

  const reconciledFilter = sp.reconciled ?? 'all'
  const where = [eq(bankTransactions.tenantId, tenantId), eq(bankTransactions.bankAccountId, id)]
  if (reconciledFilter === 'yes') where.push(sql`${bankTransactions.reconciledAt} IS NOT NULL`)
  if (reconciledFilter === 'no') where.push(sql`${bankTransactions.reconciledAt} IS NULL`)

  const txs = await db
    .select({
      id: bankTransactions.id,
      postedAt: bankTransactions.postedAt,
      amountCents: bankTransactions.amountCents,
      description: bankTransactions.description,
      memo: bankTransactions.memo,
      source: bankTransactions.source,
      reconciledAt: bankTransactions.reconciledAt,
      reconciledWithApId: bankTransactions.reconciledWithApId,
      reconciledWithArId: bankTransactions.reconciledWithArId,
      apDescription: accountsPayable.description,
      arDescription: accountsReceivable.description,
    })
    .from(bankTransactions)
    .leftJoin(accountsPayable, eq(accountsPayable.id, bankTransactions.reconciledWithApId))
    .leftJoin(accountsReceivable, eq(accountsReceivable.id, bankTransactions.reconciledWithArId))
    .where(and(...where))
    .orderBy(desc(bankTransactions.postedAt))
    .limit(500)

  const inflowSum = txs.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0)
  const outflowSum = txs.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>
          {account.nickname ?? `${account.bankName} ${account.accountNumber}`}
        </h1>
        <span style={{ flex: 1 }} />
        <Link href={`/app/financeiro/bancos/${id}/conciliar`} className="ev-btn ev-btn-primary">
          Conciliar
        </Link>
        <Link href="/app/financeiro/bancos" className="ev-btn ev-btn-ghost">
          ← Bancos
        </Link>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Saldo atual</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(account.currentBalanceCents)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Entradas (no filtro)
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(inflowSum)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Saídas (no filtro)
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-danger, #dc2626)',
            }}
          >
            {formatBrl(outflowSum)}
          </div>
        </div>
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Última sync</div>
          <div style={{ fontSize: 'var(--ev-font-sm)' }}>
            {account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('pt-BR') : '—'}
          </div>
        </div>
      </div>

      <OfxImportForm bankAccountId={id} />

      <form
        method="GET"
        className="ev-card"
        style={{
          padding: 'var(--ev-space-sm)',
          display: 'flex',
          gap: 'var(--ev-space-sm)',
          alignItems: 'center',
        }}
      >
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--ev-font-xs)' }}>Filtro:</span>
          <select name="reconciled" defaultValue={reconciledFilter} className="ev-input">
            <option value="all">Todas</option>
            <option value="no">Pendentes de conciliação</option>
            <option value="yes">Já conciliadas</option>
          </select>
        </label>
        <button type="submit" className="ev-btn ev-btn-ghost">
          Aplicar
        </button>
      </form>

      <div className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        {txs.length === 0 ? (
          <p style={{ padding: 'var(--ev-space-md)', margin: 0, color: 'var(--ev-muted)' }}>
            Nenhuma transação. Importe um arquivo OFX para começar.
          </p>
        ) : (
          <table className="ev-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Data</th>
                <th style={{ textAlign: 'left' }}>Descrição</th>
                <th style={{ textAlign: 'left' }}>Origem</th>
                <th style={{ textAlign: 'left' }}>Conciliação</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => {
                const isOut = t.amountCents < 0
                return (
                  <tr key={t.id}>
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {new Date(t.postedAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div>{t.description}</div>
                      {t.memo && (
                        <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                          {t.memo}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="ev-badge">{t.source}</span>
                    </td>
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {t.reconciledAt ? (
                        <span style={{ color: 'var(--ev-success, #16a34a)' }}>
                          ✓ {t.apDescription ?? t.arDescription ?? '—'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ev-warning, #92400e)' }}>Pendente</span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: isOut ? 'var(--ev-danger, #dc2626)' : 'var(--ev-success, #16a34a)',
                        fontWeight: 600,
                      }}
                    >
                      {formatBrl(t.amountCents)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
