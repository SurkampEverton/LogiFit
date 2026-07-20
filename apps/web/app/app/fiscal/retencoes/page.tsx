/**
 * `/app/fiscal/retencoes` — relatório de retenções por tributo (Sprint 15b,
 * ADR 0061 Grupos B e G).
 *
 * Agrupa `tax_retentions` por tributo na competência escolhida: é a base que
 * o contador usa pra emitir DARF/GPS. Read-only — o campo `guide_reference`
 * (número da guia paga) entra na fase 2 junto com a baixa.
 *
 * Acesso: `fiscal.read` (staff) ou role `contador_externo`.
 */
import { db } from '@repo/db/client'
import { taxRetentions } from '@repo/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasPermission } from '../../../lib/permissions'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const TAX_LABEL: Record<string, string> = {
  pis: 'PIS',
  cofins: 'COFINS',
  csll: 'CSLL',
  irrf: 'IRRF',
  inss: 'INSS',
  iss: 'ISS',
}

/** Guia onde cada tributo é recolhido — orienta o contador. */
const TAX_GUIDE: Record<string, string> = {
  pis: 'DARF federal',
  cofins: 'DARF federal',
  csll: 'DARF federal',
  irrf: 'DARF federal',
  inss: 'GPS / DARF previdenciário',
  iss: 'Guia municipal (ISS)',
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function RetencoesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/fiscal/retencoes')
  if (!(await hasPermission(session.logifit.userId, 'fiscal.read'))) redirect('/app')

  const yearMonth = /^\d{4}-\d{2}$/.test(params.month ?? '')
    ? (params.month as string)
    : currentYearMonth()

  const byTax = await db
    .select({
      tax: taxRetentions.tax,
      totalBaseCents: sql<number>`sum(base_cents)::bigint`,
      totalAmountCents: sql<number>`sum(amount_cents)::bigint`,
      count: sql<number>`count(*)::int`,
      pendingCount: sql<number>`count(*) FILTER (WHERE guide_status = 'pending')::int`,
    })
    .from(taxRetentions)
    .where(
      and(
        eq(taxRetentions.tenantId, session.logifit.tenantId),
        eq(taxRetentions.yearMonth, yearMonth),
      ),
    )
    .groupBy(taxRetentions.tax)
    .orderBy(taxRetentions.tax)

  const totalRetido = byTax.reduce((s, r) => s + Number(r.totalAmountCents), 0)
  const totalPendente = byTax.reduce((s, r) => s + r.pendingCount, 0)

  // Meses disponíveis pro seletor (últimos 12 com dado + o corrente)
  const months = await db
    .selectDistinct({ yearMonth: taxRetentions.yearMonth })
    .from(taxRetentions)
    .where(eq(taxRetentions.tenantId, session.logifit.tenantId))
    .orderBy(sql`year_month DESC`)
    .limit(12)
  const monthOptions = [...new Set([currentYearMonth(), ...months.map((m) => m.yearMonth)])].sort(
    (a, b) => b.localeCompare(a),
  )

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Retenções por tributo</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>competência {yearMonth}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/fiscal" className="ev-btn ev-btn-ghost">
          ← Emissões
        </Link>
      </header>

      <form method="get" className="ev-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="ev-stack-sm">
          <span style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-sm)' }}>
            Competência
          </span>
          <select name="month" defaultValue={yearMonth} className="ev-input">
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ev-btn ev-btn-primary">
          Ver
        </button>
      </form>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div className="ev-card">
          <div className="ev-card__title">Total retido no mês</div>
          <p className="num" style={{ fontSize: 'var(--ev-text-2xl)', margin: 0 }}>
            {brl(totalRetido)}
          </p>
        </div>
        <div className="ev-card">
          <div className="ev-card__title">Guias pendentes</div>
          <p className="num" style={{ fontSize: 'var(--ev-text-2xl)', margin: 0 }}>
            {totalPendente}
          </p>
        </div>
      </section>

      {byTax.length === 0 ? (
        <div className="ev-card" style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--ev-text-muted)' }}>
            Nenhuma retenção calculada em {yearMonth}. Retenções aparecem aqui quando contas a pagar
            e comissões com natureza tributária são registradas.
          </p>
        </div>
      ) : (
        <div className="ev-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ev-table">
            <thead>
              <tr>
                <th>Tributo</th>
                <th>Guia</th>
                <th>Lançamentos</th>
                <th>Base acumulada</th>
                <th>Total retido</th>
                <th>Pendentes</th>
              </tr>
            </thead>
            <tbody>
              {byTax.map((row) => (
                <tr key={row.tax}>
                  <td>
                    <strong>{TAX_LABEL[row.tax] ?? row.tax}</strong>
                  </td>
                  <td style={{ color: 'var(--ev-text-muted)' }}>{TAX_GUIDE[row.tax] ?? '—'}</td>
                  <td className="num">{row.count}</td>
                  <td className="num">{brl(Number(row.totalBaseCents))}</td>
                  <td className="num">
                    <strong>{brl(Number(row.totalAmountCents))}</strong>
                  </td>
                  <td className="num">{row.pendingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: 'var(--ev-text-muted)', fontSize: 'var(--ev-text-xs)', margin: 0 }}>
        Valores calculados pelo motor de retenções (ADR 0061) sobre contas a pagar e comissões.
        Confira com seu contador antes de recolher — o LogiFit não emite guias oficiais (Sprint 38).
        Export PDF/CSV e baixa de guia entram na fase 2.
      </p>
    </div>
  )
}
