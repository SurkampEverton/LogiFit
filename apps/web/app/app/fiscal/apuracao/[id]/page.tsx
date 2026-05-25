/**
 * `/app/fiscal/apuracao/[id]` — Detalhe da Apuração Fiscal Mensal (Sprint 37a, ADR 0100).
 *
 * Mostra:
 *   - Header (company + year_month + tax_regime + status badge)
 *   - 3 KPI cards: Receita Bruta × Imposto × Alíquota Efetiva
 *   - Breakdown table por fiscal_emission_kind (count + total)
 *   - Memorial expandido linha-a-linha
 *   - Actions inline (regenerar + fechar) — Sprint 37b adiciona PDF export
 */
import { db } from '@repo/db/client'
import {
  companies,
  fiscalRevenueAggregations,
  fiscalRevenueBreakdown,
  persons,
} from '@repo/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { ApuracaoActions } from './actions-client'

export const dynamic = 'force-dynamic'

interface MemorialLine {
  step: number
  label: string
  formula?: string
  valueCents?: number
  note?: string
}

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
}

const EMISSION_KIND_LABEL: Record<string, string> = {
  nfse: 'NFS-e',
  nfe: 'NF-e produto',
  nfce: 'NFC-e',
  nfe_return: 'Devolução',
  nfe_transfer: 'Transferência',
  nfe_conserto_out: 'Conserto saída',
  nfe_conserto_return: 'Conserto retorno',
  nfe_self_entry: 'Entrada própria',
}

interface StatusStyle {
  bg: string
  fg: string
  label: string
}

const STATUS_DRAFT: StatusStyle = {
  bg: 'var(--ev-muted-bg, #e5e7eb)',
  fg: 'var(--ev-muted, #6b7280)',
  label: 'Rascunho (editável)',
}
const STATUS_CLOSED: StatusStyle = {
  bg: 'var(--ev-success-bg, #dcfce7)',
  fg: 'var(--ev-success, #16a34a)',
  label: 'Fechada (imutável)',
}
const STATUS_STYLE: Record<string, StatusStyle> = {
  draft: STATUS_DRAFT,
  closed: STATUS_CLOSED,
}

function formatBrl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatAliquota(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—'
  return `${(bp / 100).toFixed(2)}%`
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function ApuracaoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/fiscal/apuracao/${id}`)
  const tenantId = session.logifit.tenantId

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound()
  }

  const [agg] = await db
    .select()
    .from(fiscalRevenueAggregations)
    .where(
      and(eq(fiscalRevenueAggregations.id, id), eq(fiscalRevenueAggregations.tenantId, tenantId)),
    )
    .limit(1)

  if (!agg) notFound()

  const [company] = await db
    .select({ id: companies.id, name: persons.name })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.id, agg.companyId))
    .limit(1)

  const breakdown = await db
    .select()
    .from(fiscalRevenueBreakdown)
    .where(eq(fiscalRevenueBreakdown.aggregationId, agg.id))
    .orderBy(asc(fiscalRevenueBreakdown.emissionKind))

  const memorial = (agg.memorial as MemorialLine[] | null) ?? []
  const sty = STATUS_STYLE[agg.status] ?? STATUS_DRAFT

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          <Link href="/app" style={{ color: 'inherit' }}>
            Início
          </Link>
          {' / '}
          <Link href="/app/fiscal" style={{ color: 'inherit' }}>
            Fiscal
          </Link>
          {' / '}
          <Link href="/app/fiscal/apuracao" style={{ color: 'inherit' }}>
            Apuração
          </Link>
          {' / '}
          <span>{agg.yearMonth}</span>
        </nav>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Apuração {agg.yearMonth}</h1>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: sty.bg, color: sty.fg }}
          >
            {sty.label}
          </span>
        </div>
        <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          {company?.name ?? agg.companyId.slice(0, 8)} ·{' '}
          {REGIME_LABEL[agg.taxRegime] ?? agg.taxRegime} ·{' '}
          {agg.status === 'closed'
            ? `Fechada em ${formatDateTime(agg.closedAt)}`
            : `Calculada em ${formatDateTime(agg.computedAt)}`}
        </p>
        <ApuracaoActions
          aggregationId={agg.id}
          isClosed={agg.status === 'closed'}
          yearMonth={agg.yearMonth}
        />
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Receita Bruta"
          value={formatBrl(agg.receitaTotalCents)}
          subtitle={`Serviços: ${formatBrl(agg.receitaServicosCents)} · Mercadorias: ${formatBrl(agg.receitaMercadoriasCents)}`}
        />
        <KpiCard
          label="Imposto Apurado"
          value={formatBrl(agg.impostoApuradoCents)}
          subtitle="Estimativa pré-DAS/DARF"
        />
        <KpiCard
          label="Alíquota Efetiva"
          value={formatAliquota(agg.aliquotaEfetivaBp)}
          subtitle={
            agg.rbt12Cents !== null
              ? `RBT12: ${formatBrl(agg.rbt12Cents)}`
              : 'Variável conforme tributo'
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Quebra por tipo de nota ({breakdown.length})</h2>
        {breakdown.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm"
            style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
          >
            Sem emissões registradas no período.
          </p>
        ) : (
          <div
            className="overflow-x-auto rounded-md border"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
                >
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium text-right">Quantidade</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--ev-border)' }}
                  >
                    <td className="px-3 py-2">
                      {EMISSION_KIND_LABEL[b.emissionKind] ?? b.emissionKind}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right">{b.count}</td>
                    <td className="px-3 py-2 tabular-nums text-right">{formatBrl(b.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Memorial do cálculo ({memorial.length} linhas)</h2>
        {memorial.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm"
            style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
          >
            Memorial vazio — rode <code>regenerateAggregation</code> pra reconstruir.
          </p>
        ) : (
          <ol
            className="space-y-3 rounded-md border p-4"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            {memorial.map((line, idx) => (
              <li
                key={`${line.step}-${idx}`}
                className="flex flex-wrap items-baseline gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                style={{ borderColor: 'var(--ev-border)' }}
              >
                <span
                  className="text-xs tabular-nums"
                  style={{ color: 'var(--ev-text-muted)', minWidth: '36px', textAlign: 'right' }}
                >
                  #{line.step}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">{line.label}</div>
                  {line.formula && (
                    <div
                      className="text-xs"
                      style={{
                        color: 'var(--ev-text-muted)',
                        fontFamily: 'var(--ev-mono, ui-monospace)',
                      }}
                    >
                      {line.formula}
                    </div>
                  )}
                  {line.note && (
                    <div className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                      {line.note}
                    </div>
                  )}
                </div>
                {line.valueCents !== undefined && (
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{ minWidth: '120px', textAlign: 'right' }}
                  >
                    {formatBrl(line.valueCents)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="rounded-md border p-4 text-xs"
        style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
      >
        <strong style={{ color: 'var(--ev-text)' }}>Aviso:</strong> esta é uma{' '}
        <em>apuração operacional</em> calculada pelo motor LogiFit (Sprint 37a, ADR 0100). A guia
        oficial DAS/DARF é emitida na Sprint 38 — até lá, valide o valor com seu contador antes de
        pagar. O memorial acima preserva o passo-a-passo do cálculo pra auditoria.
      </section>
    </main>
  )
}

function KpiCard({
  label,
  value,
  subtitle,
}: {
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <div
      className="rounded-md border p-4"
      style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--ev-text-muted)' }}>
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {subtitle && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--ev-text-muted)' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
