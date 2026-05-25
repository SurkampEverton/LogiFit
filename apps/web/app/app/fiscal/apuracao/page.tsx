/**
 * `/app/fiscal/apuracao` — Hub Apuração Fiscal Mensal (Sprint 37a, ADR 0100).
 *
 * Lista filtrável por year + companyId + status. 4 KPI cards:
 *   - Aguardando (status=draft)
 *   - Fechadas (status=closed)
 *   - Receita 12m (soma receita_total_cents últimas 12 apurações)
 *   - Imposto 12m (soma imposto_apurado_cents últimas 12 apurações)
 *
 * Sprint 37b: botão "Calcular nova apuração" com modal year+month+companyId
 * (MVP roda via API/Server Action externa; UI só mostra estado existente).
 */
import { db } from '@repo/db/client'
import { companies, fiscalRevenueAggregations, persons } from '@repo/db/schema'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { isFeatureEnabled } from '../../../lib/feature-flags'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  year?: string
  companyId?: string
  status?: string
}

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
}

interface StatusStyle {
  bg: string
  fg: string
  label: string
}

const STATUS_DRAFT: StatusStyle = {
  bg: 'var(--ev-muted-bg, #e5e7eb)',
  fg: 'var(--ev-muted, #6b7280)',
  label: 'Rascunho',
}
const STATUS_CLOSED: StatusStyle = {
  bg: 'var(--ev-success-bg, #dcfce7)',
  fg: 'var(--ev-success, #16a34a)',
  label: 'Fechada',
}
const STATUS_STYLE: Record<string, StatusStyle> = {
  draft: STATUS_DRAFT,
  closed: STATUS_CLOSED,
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatAliquota(bp: number | null): string {
  if (bp === null) return '—'
  return `${(bp / 100).toFixed(2)}%`
}

export default async function FiscalApuracaoHubPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/fiscal/apuracao')
  const tenantId = session.logifit.tenantId

  // Feature flag gate (ADR 0098). Fail-closed: false quando flag não seedada.
  if (!(await isFeatureEnabled('fiscal_apuracao_v1'))) {
    return <FeatureGatedNotice />
  }

  // Load companies do tenant pro filter dropdown
  const companyRows = await db
    .select({ id: companies.id, name: persons.name })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  // Filtros
  const year = params.year ? Number(params.year) : new Date().getUTCFullYear()
  const companyId = params.companyId ?? null
  const status = params.status ?? null

  const conditions = [eq(fiscalRevenueAggregations.tenantId, tenantId)]
  if (companyId) conditions.push(eq(fiscalRevenueAggregations.companyId, companyId))
  if (status === 'draft' || status === 'closed') {
    conditions.push(eq(fiscalRevenueAggregations.status, status))
  }
  conditions.push(sql`${fiscalRevenueAggregations.yearMonth} LIKE ${`${year}-%`}`)

  const aggs = await db
    .select({
      id: fiscalRevenueAggregations.id,
      yearMonth: fiscalRevenueAggregations.yearMonth,
      companyId: fiscalRevenueAggregations.companyId,
      taxRegime: fiscalRevenueAggregations.taxRegime,
      receitaTotalCents: fiscalRevenueAggregations.receitaTotalCents,
      impostoApuradoCents: fiscalRevenueAggregations.impostoApuradoCents,
      aliquotaEfetivaBp: fiscalRevenueAggregations.aliquotaEfetivaBp,
      status: fiscalRevenueAggregations.status,
      closedAt: fiscalRevenueAggregations.closedAt,
    })
    .from(fiscalRevenueAggregations)
    .where(and(...conditions))
    .orderBy(desc(fiscalRevenueAggregations.yearMonth))
    .limit(50)

  // KPIs — 12 últimos meses (rolling)
  const kpiRows = await db
    .select({
      receitaTotal: sql<number>`COALESCE(SUM(${fiscalRevenueAggregations.receitaTotalCents}), 0)`,
      imposto: sql<number>`COALESCE(SUM(${fiscalRevenueAggregations.impostoApuradoCents}), 0)`,
      draftCount: sql<number>`COUNT(*) FILTER (WHERE ${fiscalRevenueAggregations.status} = 'draft')`,
      closedCount: sql<number>`COUNT(*) FILTER (WHERE ${fiscalRevenueAggregations.status} = 'closed')`,
    })
    .from(fiscalRevenueAggregations)
    .where(eq(fiscalRevenueAggregations.tenantId, tenantId))
  const kpis = kpiRows[0] ?? { receitaTotal: 0, imposto: 0, draftCount: 0, closedCount: 0 }

  const companyName = (id: string) => companyRows.find((c) => c.id === id)?.name ?? id.slice(0, 8)

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
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
          <span>Apuração</span>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">Apuração fiscal mensal</h1>
        <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          Cálculo pré-DAS/pré-DARF por regime tributário. Sprint 38 emite as guias oficiais.
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Aguardando"
          value={Number(kpis.draftCount).toString()}
          subtitle="rascunhos"
        />
        <KpiCard
          label="Fechadas"
          value={Number(kpis.closedCount).toString()}
          subtitle="apurações"
        />
        <KpiCard
          label="Receita 12m"
          value={formatBrl(Number(kpis.receitaTotal))}
          subtitle="(estimada)"
        />
        <KpiCard
          label="Imposto 12m"
          value={formatBrl(Number(kpis.imposto))}
          subtitle="(pré-DAS/DARF)"
        />
      </section>

      {/* Filtros */}
      <section
        className="rounded-md border p-4 space-y-3"
        style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
      >
        <h2 className="text-sm font-medium">Filtros</h2>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="year" className="block text-xs font-medium mb-1">
              Ano
            </label>
            <input
              id="year"
              name="year"
              type="number"
              defaultValue={year}
              min={2020}
              max={2100}
              className="ev-input"
              style={{ width: '120px' }}
            />
          </div>
          <div>
            <label htmlFor="companyId" className="block text-xs font-medium mb-1">
              Filial
            </label>
            <select
              id="companyId"
              name="companyId"
              defaultValue={companyId ?? ''}
              className="ev-input"
              style={{ minWidth: '200px' }}
            >
              <option value="">Todas as filiais</option>
              {companyRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className="block text-xs font-medium mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ''}
              className="ev-input"
              style={{ minWidth: '160px' }}
            >
              <option value="">Todos</option>
              <option value="draft">Rascunho</option>
              <option value="closed">Fechadas</option>
            </select>
          </div>
          <button type="submit" className="ev-btn ev-btn-primary">
            Aplicar
          </button>
        </form>
      </section>

      {/* Lista */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Apurações de {year} ({aggs.length})
        </h2>
        {aggs.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm"
            style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
          >
            Nenhuma apuração registrada pra este filtro. Use a Server Action{' '}
            <code>aggregateMonthlyRevenue</code> pra criar a primeira (modal de criação entra na
            Sprint 37b).
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
                  <th className="px-3 py-2 font-medium">Competência</th>
                  <th className="px-3 py-2 font-medium">Filial</th>
                  <th className="px-3 py-2 font-medium">Regime</th>
                  <th className="px-3 py-2 font-medium text-right">Receita</th>
                  <th className="px-3 py-2 font-medium text-right">Alíquota</th>
                  <th className="px-3 py-2 font-medium text-right">Imposto</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {aggs.map((a) => {
                  const sty = STATUS_STYLE[a.status] ?? STATUS_DRAFT
                  return (
                    <tr
                      key={a.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--ev-border)' }}
                    >
                      <td className="px-3 py-2 tabular-nums">{a.yearMonth}</td>
                      <td className="px-3 py-2">{companyName(a.companyId)}</td>
                      <td className="px-3 py-2 text-xs">
                        {REGIME_LABEL[a.taxRegime] ?? a.taxRegime}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right">
                        {formatBrl(a.receitaTotalCents)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right">
                        {formatAliquota(a.aliquotaEfetivaBp)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right">
                        {formatBrl(a.impostoApuradoCents)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: sty.bg, color: sty.fg }}
                        >
                          {sty.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/app/fiscal/apuracao/${a.id}`}
                          className="text-xs underline"
                          style={{ color: 'var(--ev-link, #2563eb)' }}
                        >
                          Detalhe →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

function FeatureGatedNotice() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-2 mb-6">
        <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          <Link href="/app" style={{ color: 'inherit' }}>
            Início
          </Link>
          {' / '}
          <Link href="/app/fiscal" style={{ color: 'inherit' }}>
            Fiscal
          </Link>
          {' / '}
          <span>Apuração</span>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">Apuração fiscal mensal</h1>
      </header>
      <div
        className="rounded-md border p-6 space-y-3"
        style={{
          borderColor: 'var(--ev-warning-fg, #92400e)',
          background: 'var(--ev-warning-bg, #fef3c7)',
          color: 'var(--ev-warning-fg, #92400e)',
        }}
      >
        <h2 className="text-lg font-medium">Em piloto fechado</h2>
        <p className="text-sm">
          O motor de apuração fiscal (Sprint 37, ADR 0100) ainda está em piloto fechado. Valide com
          o seu contador <strong>3 cenários canônicos do seu regime</strong>{' '}
          (Simples/Presumido/Real/MEI) antes de habilitar — diferenças entre cálculo operacional e
          PGDAS-D oficial podem variar até ±5% nas faixas típicas.
        </p>
        <p className="text-sm">
          Pra liberar acesso, peça ao administrador do tenant ativar a feature flag{' '}
          <code style={{ fontFamily: 'var(--ev-mono, ui-monospace)' }}>fiscal_apuracao_v1</code>.
        </p>
      </div>
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
