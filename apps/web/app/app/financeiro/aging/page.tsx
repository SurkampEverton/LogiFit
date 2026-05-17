/**
 * `/app/financeiro/aging` — relatório aging AP + AR (Sprint 15 Faixa C).
 *
 * Agrupa lançamentos abertos por faixa de dias atrasados/a vencer:
 *   - a vencer (due_date >= hoje)
 *   - 1-30 dias
 *   - 31-60 dias
 *   - 61-90 dias
 *   - 90+ dias
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  accountsPayable,
  accountsReceivable,
  persons,
  suppliers,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  dueDate: string
  amountCents: number
  partyName: string | null
  description: string | null
}

interface AgingBucket {
  label: string
  range: string
  cents: number
  count: number
  rows: Row[]
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function daysBetween(due: string, today: string): number {
  const d1 = new Date(due + 'T00:00:00Z').getTime()
  const d2 = new Date(today + 'T00:00:00Z').getTime()
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24))
}

function bucketize(rows: Row[]): AgingBucket[] {
  const today = new Date().toISOString().slice(0, 10)
  const buckets: AgingBucket[] = [
    { label: 'A vencer', range: 'due >= hoje', cents: 0, count: 0, rows: [] },
    { label: '1-30 dias atraso', range: '1-30', cents: 0, count: 0, rows: [] },
    { label: '31-60 dias', range: '31-60', cents: 0, count: 0, rows: [] },
    { label: '61-90 dias', range: '61-90', cents: 0, count: 0, rows: [] },
    { label: '90+ dias', range: '90+', cents: 0, count: 0, rows: [] },
  ]
  for (const r of rows) {
    const d = daysBetween(r.dueDate, today)
    let idx = 0
    if (d <= 0) idx = 0
    else if (d <= 30) idx = 1
    else if (d <= 60) idx = 2
    else if (d <= 90) idx = 3
    else idx = 4
    buckets[idx]!.cents += r.amountCents
    buckets[idx]!.count += 1
    buckets[idx]!.rows.push(r)
  }
  return buckets
}

export default async function AgingPage() {
  const session = await requireFullSession('/app/financeiro/aging')
  const tenantId = session.logifit.tenantId

  const apRows: Row[] = await db
    .select({
      id: accountsPayable.id,
      dueDate: accountsPayable.dueDate,
      amountCents: accountsPayable.netAmountCents,
      partyName: persons.name,
      description: accountsPayable.description,
    })
    .from(accountsPayable)
    .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
    .leftJoin(persons, eq(persons.id, suppliers.personId))
    .where(
      and(
        eq(accountsPayable.tenantId, tenantId),
        sql`${accountsPayable.status} IN ('pending_approval','approved','scheduled')`,
      ),
    )
  const arRows: Row[] = await db
    .select({
      id: accountsReceivable.id,
      dueDate: accountsReceivable.dueDate,
      amountCents: accountsReceivable.amountCents,
      partyName: persons.name,
      description: accountsReceivable.description,
    })
    .from(accountsReceivable)
    .leftJoin(persons, eq(persons.id, accountsReceivable.payerPersonId))
    .where(
      and(
        eq(accountsReceivable.tenantId, tenantId),
        sql`${accountsReceivable.status} IN ('draft','issued','overdue')`,
      ),
    )

  const apBuckets = bucketize(apRows)
  const arBuckets = bucketize(arRows)

  const totalAp = apBuckets.reduce((s, b) => s + b.cents, 0)
  const totalAr = arBuckets.reduce((s, b) => s + b.cents, 0)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Aging</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Distribuição de lançamentos abertos por faixa de vencimento. AP em pending_approval/approved/scheduled;
        AR em draft/issued/overdue.
      </p>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Contas a pagar</h2>
          <span style={{ color: 'var(--ev-muted)' }}>Total: {formatBrl(totalAp)}</span>
        </header>
        <BucketTable buckets={apBuckets} kind="pagar" />
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--ev-font-md)' }}>Contas a receber</h2>
          <span style={{ color: 'var(--ev-muted)' }}>Total: {formatBrl(totalAr)}</span>
        </header>
        <BucketTable buckets={arBuckets} kind="receber" />
      </section>
    </div>
  )
}

function BucketTable({ buckets, kind }: { buckets: AgingBucket[]; kind: 'pagar' | 'receber' }) {
  const max = Math.max(1, ...buckets.map((b) => b.cents))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ev-space-sm)' }}>
      {buckets.map((b) => {
        const pct = b.cents > 0 ? Math.max(2, Math.round((b.cents / max) * 100)) : 0
        const color =
          b.range === 'due >= hoje'
            ? 'var(--ev-success, #16a34a)'
            : b.range === '1-30'
              ? 'var(--ev-info, #1e40af)'
              : b.range === '31-60'
                ? 'var(--ev-warning, #92400e)'
                : 'var(--ev-danger, #dc2626)'
        return (
          <div key={b.range} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 'var(--ev-font-sm)' }}>
                <strong>{b.label}</strong>{' '}
                <span style={{ color: 'var(--ev-muted)' }}>({b.count})</span>
              </span>
              <span style={{ fontWeight: 600 }}>{formatBrl(b.cents)}</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                backgroundColor: 'var(--ev-muted-bg, #f3f4f6)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: color,
                  transition: 'width 200ms',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
