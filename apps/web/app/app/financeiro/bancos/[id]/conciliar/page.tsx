/**
 * `/app/financeiro/bancos/[id]/conciliar` — sugestões de conciliação (Sprint 17 Faixa C).
 *
 * Lista transações pendentes da conta; client component chama `suggestMatchesAction` por linha.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { bankAccounts, bankTransactions } from '@repo/db/schema'
import { requireFullSession } from '../../../../../lib/session'
import { ConciliacaoList } from './conciliacao-list'

export const dynamic = 'force-dynamic'

export default async function ConciliarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/financeiro/bancos/${id}/conciliar`)
  const tenantId = session.logifit.tenantId

  const [account] = await db
    .select({
      id: bankAccounts.id,
      bankName: bankAccounts.bankName,
      nickname: bankAccounts.nickname,
      accountNumber: bankAccounts.accountNumber,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.tenantId, tenantId)))
    .limit(1)
  if (!account) notFound()

  const pending = await db
    .select({
      id: bankTransactions.id,
      postedAt: bankTransactions.postedAt,
      amountCents: bankTransactions.amountCents,
      description: bankTransactions.description,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.tenantId, tenantId),
        eq(bankTransactions.bankAccountId, id),
        isNull(bankTransactions.reconciledAt),
      ),
    )
    .orderBy(desc(bankTransactions.postedAt))
    .limit(50)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Conciliar — {account.nickname ?? account.bankName}</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{pending.length} transações pendentes</span>
        <span style={{ flex: 1 }} />
        <Link href={`/app/financeiro/bancos/${id}/extrato`} className="ev-btn ev-btn-ghost">
          ← Extrato
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Sistema sugere matches AP/AR baseado em valor + data + descrição. Aceite ou rejeite cada
        sugestão. Aceitar marca a transação como conciliada.
      </p>

      <ConciliacaoList
        transactions={pending.map((t) => ({
          id: t.id,
          postedAt: new Date(t.postedAt).toISOString(),
          amountCents: t.amountCents,
          description: t.description,
        }))}
      />
    </div>
  )
}
