/**
 * `/app/financeiro/receita` — dashboard unificado online (Sprint 04) + presencial (Sprint 18).
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  acquirerConnections,
  acquirerSales,
  companies,
  invoices,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function pctOf(part: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

export default async function ReceitaUnificadaPage({
  searchParams,
}: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requireFullSession('/app/financeiro/receita')
  const tenantId = session.logifit.tenantId

  const params = await searchParams
  const today = new Date()
  const last30d = new Date()
  last30d.setDate(today.getDate() - 30)
  const from = params.from ?? last30d.toISOString().slice(0, 10)
  const to = params.to ?? today.toISOString().slice(0, 10)
  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate = new Date(to + 'T23:59:59Z')

  // Online (invoices.paid)
  const [online] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      amountCents: sql<number>`COALESCE(SUM(${invoices.amountCents}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.status, 'paid'),
        gte(invoices.paidAt, fromDate),
        lte(invoices.paidAt, toDate),
      ),
    )

  // Presencial (acquirer_sales)
  const [presential] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      grossCents: sql<number>`COALESCE(SUM(${acquirerSales.grossAmountCents}), 0)::bigint`,
      netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
      feeCents: sql<number>`COALESCE(SUM(${acquirerSales.feeCents}), 0)::bigint`,
    })
    .from(acquirerSales)
    .where(
      and(
        eq(acquirerSales.tenantId, tenantId),
        gte(acquirerSales.capturedAt, fromDate),
        lte(acquirerSales.capturedAt, toDate),
        sql`${acquirerSales.status} NOT IN ('cancelled', 'chargeback')`,
      ),
    )

  // Quebra por provider
  const byProvider = await db
    .select({
      provider: acquirerConnections.provider,
      count: sql<number>`COUNT(${acquirerSales.id})::int`,
      netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
      feeCents: sql<number>`COALESCE(SUM(${acquirerSales.feeCents}), 0)::bigint`,
    })
    .from(acquirerSales)
    .leftJoin(acquirerConnections, eq(acquirerConnections.id, acquirerSales.connectionId))
    .where(
      and(
        eq(acquirerSales.tenantId, tenantId),
        gte(acquirerSales.capturedAt, fromDate),
        lte(acquirerSales.capturedAt, toDate),
        sql`${acquirerSales.status} NOT IN ('cancelled', 'chargeback')`,
      ),
    )
    .groupBy(acquirerConnections.provider)
    .orderBy(asc(acquirerConnections.provider))

  // Quebra por company (top 5)
  const byCompany = await db
    .select({
      companyId: acquirerSales.companyId,
      name: persons.name,
      netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
    })
    .from(acquirerSales)
    .leftJoin(companies, eq(companies.id, acquirerSales.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(
      and(
        eq(acquirerSales.tenantId, tenantId),
        gte(acquirerSales.capturedAt, fromDate),
        lte(acquirerSales.capturedAt, toDate),
        sql`${acquirerSales.status} NOT IN ('cancelled', 'chargeback')`,
      ),
    )
    .groupBy(acquirerSales.companyId, persons.name)
    .orderBy(sql`SUM(${acquirerSales.netAmountCents}) DESC`)
    .limit(5)

  const onlineAmount = Number(online?.amountCents ?? 0)
  const presentialNet = Number(presential?.netCents ?? 0)
  const presentialGross = Number(presential?.grossCents ?? 0)
  const presentialFee = Number(presential?.feeCents ?? 0)
  const total = onlineAmount + presentialNet

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Receita unificada</h1>
        <span style={{ flex: 1 }} />
        <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="ev-input" type="date" name="from" defaultValue={from} />
          <span style={{ color: 'var(--ev-muted)' }}>→</span>
          <input className="ev-input" type="date" name="to" defaultValue={to} />
          <button type="submit" className="ev-btn ev-btn-primary">
            Filtrar
          </button>
        </form>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Online</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{formatBrl(onlineAmount)}</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Asaas · {online?.count ?? 0} pagamentos · {pctOf(onlineAmount, total)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Presencial (líquido)
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{formatBrl(presentialNet)}</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Maquininha · {presential?.count ?? 0} vendas · {pctOf(presentialNet, total)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Total líquido</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{formatBrl(total)}</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Online + presencial
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Custo taxas
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600, color: 'var(--ev-danger, #b91c1c)' }}>
            − {formatBrl(presentialFee)}
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Margem líquida {pctOf(presentialNet, presentialGross)} sobre bruto presencial
          </div>
        </div>
      </section>

      <section>
        <h2>Quebra por provider</h2>
        {byProvider.length === 0 ? (
          <p style={{ color: 'var(--ev-muted)' }}>Sem vendas presenciais no período.</p>
        ) : (
          <table className="ev-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Provider</th>
                <th style={{ textAlign: 'right' }}>Vendas</th>
                <th style={{ textAlign: 'right' }}>Líquido</th>
                <th style={{ textAlign: 'right' }}>Taxa</th>
                <th style={{ textAlign: 'right' }}>% do presencial</th>
              </tr>
            </thead>
            <tbody>
              {byProvider.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td style={{ textAlign: 'right' }}>{p.count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(Number(p.netCents))}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--ev-muted)' }}>
                    {formatBrl(Number(p.feeCents))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {pctOf(Number(p.netCents), presentialNet)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Top companies (presencial)</h2>
        {byCompany.length === 0 ? (
          <p style={{ color: 'var(--ev-muted)' }}>—</p>
        ) : (
          <table className="ev-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Company</th>
                <th style={{ textAlign: 'right' }}>Líquido</th>
                <th style={{ textAlign: 'right' }}>% do presencial</th>
              </tr>
            </thead>
            <tbody>
              {byCompany.map((c) => (
                <tr key={c.companyId}>
                  <td>{c.name ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatBrl(Number(c.netCents))}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {pctOf(Number(c.netCents), presentialNet)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
