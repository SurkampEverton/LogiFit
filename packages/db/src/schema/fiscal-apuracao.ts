/**
 * Fiscal Apuração Mensal — Sprint 37a (ADR 0100 Proposed).
 *
 * Grupo C fiscal (ADR 0061): apuração operacional mensal de receita por
 * regime tributário com memorial detalhado. **Sem emissão oficial** —
 * Sprint 38 cobre DAS/DARF.
 *
 * 3 tabelas:
 *   - `fiscal_revenue_aggregations` — agregação 1:1 por (tenant, company, year_month)
 *     com snapshot do regime + receita bruta + imposto apurado + memorial jsonb.
 *     Status workflow: draft (editável + regerável) → closed (imutável).
 *   - `fiscal_revenue_breakdown` — 1:N filha; quebra por emission_kind
 *     (NFS-e/NF-e/NFC-e/etc) com count + total. Permite drill-down sem
 *     reler `fiscal_emissions`.
 *   - `fiscal_simples_brackets` — lookup GLOBAL Anexos III + V vigentes
 *     com valid_from/valid_to. Tenant não edita. Atualização anual via
 *     migration data nova.
 *
 * **Append-then-update durante draft** — INSERT no aggregateMonthlyRevenue;
 * UPDATE permitido enquanto status='draft'; trigger SQL bloqueia UPDATE
 * em 'closed'.
 *
 * @volume_estimate_yearly: 12k+
 *   (1k tenants × 1 company × 12 meses = 12k MVP; cresce com multi-company)
 *   Regra 34 não exige particionamento (limite 5M/ano ou 50k/dia).
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { fiscalEmissionKindEnum, fiscalTaxRegimeEnum } from './fiscal'
import { companies } from './identity'

// ─── fiscal_revenue_aggregations ─────────────────────────────────────────
/**
 * Agregação 1:1 por (tenant_id, company_id, year_month).
 *
 * `tax_regime` é **snapshot do `companies.regime_tributario`** na hora do
 * cálculo. Trocar regime virada de ano não muda apurações antigas — preserva
 * audit trail.
 *
 * `memorial` é array jsonb estruturado: cada linha é
 *   `{ step: number, label: string, formula?: string, value_cents?: number, note?: string }`
 *
 * Status workflow:
 *   - `draft` — INSERT inicial + UPDATEs subsequentes via regenerateAggregation
 *   - `closed` — UPDATE bloqueado por trigger SQL; pode reabrir só via SUPER_ADMIN
 *     (Sprint 37c+; MVP fechamento é irreversível)
 */
export const fiscalRevenueAggregations = pgTable(
  'fiscal_revenue_aggregations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** 'YYYY-MM' — ex: '2026-05'. Validado por check constraint. */
    yearMonth: text('year_month').notNull(),
    /** Snapshot do regime tributário vigente na hora do cálculo. */
    taxRegime: fiscalTaxRegimeEnum('tax_regime').notNull(),

    /** Receita bruta de serviços (soma NFS-e do mês) em centavos */
    receitaServicosCents: bigint('receita_servicos_cents', { mode: 'number' }).notNull().default(0),
    /** Receita bruta de mercadorias (soma NF-e + NFC-e do mês) em centavos */
    receitaMercadoriasCents: bigint('receita_mercadorias_cents', { mode: 'number' })
      .notNull()
      .default(0),
    /** Receita bruta total = serviços + mercadorias em centavos */
    receitaTotalCents: bigint('receita_total_cents', { mode: 'number' }).notNull().default(0),

    /** Receita bruta últimos 12 meses (Simples Nacional) em centavos. NULL pra outros regimes. */
    rbt12Cents: bigint('rbt12_cents', { mode: 'number' }),
    /** Alíquota efetiva aplicada em basis points (1075 = 10.75%). NULL pra Real (depende balancete). */
    aliquotaEfetivaBp: integer('aliquota_efetiva_bp'),
    /** Valor estimado pré-DAS/pré-DARF em centavos. Sempre populado mesmo em Real parcial. */
    impostoApuradoCents: bigint('imposto_apurado_cents', { mode: 'number' }).notNull().default(0),

    /** Array de linhas do cálculo passo-a-passo. Schema canônico no @repo/ai/fiscal-apuracao. */
    memorial: jsonb('memorial').notNull().default(sql`'[]'::jsonb`),

    /** Status workflow: draft (editável) | closed (imutável) */
    status: text('status').notNull().default('draft'),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Unique 1 apuração por (tenant, company, year_month) — recompute UPDATE in place */
    uniqueIndex('fiscal_revenue_agg_unique').on(t.tenantId, t.companyId, t.yearMonth),
    /** Inbox por tenant ordenado por year_month desc */
    index('fiscal_revenue_agg_tenant_period_idx').on(t.tenantId, t.yearMonth),
    /** Filtro status (drafts vs closed) */
    index('fiscal_revenue_agg_status_idx').on(t.tenantId, t.status),
    /** Format 'YYYY-MM' validado por regex */
    check('fiscal_revenue_agg_year_month_format', sql`year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    /** Status canônico */
    check('fiscal_revenue_agg_status_valid', sql`status IN ('draft', 'closed')`),
    /** Closed exige closed_at + closed_by */
    check(
      'fiscal_revenue_agg_closed_consistency',
      sql`(status != 'closed' OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL))`,
    ),
    /** Valores não-negativos */
    check('fiscal_revenue_agg_receita_nonneg', sql`receita_total_cents >= 0`),
    check('fiscal_revenue_agg_imposto_nonneg', sql`imposto_apurado_cents >= 0`),
    /** Aliquota basis points faixa válida 0-10000 (0%-100%) */
    check(
      'fiscal_revenue_agg_aliquota_range',
      sql`aliquota_efetiva_bp IS NULL OR (aliquota_efetiva_bp >= 0 AND aliquota_efetiva_bp <= 10000)`,
    ),
  ],
)

// ─── fiscal_revenue_breakdown ────────────────────────────────────────────
/**
 * 1:N filha. Quebra receita do mês por `fiscal_emission_kind`.
 *
 * Ex: aggregation 2026-05 da company X tem 3 rows:
 *   - kind='nfse', count=120, total=R$ 80k
 *   - kind='nfe', count=15, total=R$ 35k
 *   - kind='nfce', count=200, total=R$ 12k
 */
export const fiscalRevenueBreakdown = pgTable(
  'fiscal_revenue_breakdown',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    aggregationId: uuid('aggregation_id')
      .notNull()
      .references(() => fiscalRevenueAggregations.id, { onDelete: 'cascade' }),
    emissionKind: fiscalEmissionKindEnum('emission_kind').notNull(),
    count: integer('count').notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_revenue_breakdown_unique').on(t.aggregationId, t.emissionKind),
    index('fiscal_revenue_breakdown_agg_idx').on(t.aggregationId),
    check('fiscal_revenue_breakdown_count_nonneg', sql`count >= 0`),
    check('fiscal_revenue_breakdown_total_nonneg', sql`total_cents >= 0`),
  ],
)

// ─── fiscal_simples_brackets ─────────────────────────────────────────────
/**
 * Lookup GLOBAL Anexos III + V do Simples Nacional. **Sem `tenant_id`, sem
 * RLS** — só GRANT SELECT pra `logifit_app`. Atualização anual via migration
 * data nova (Sprint 37c).
 *
 * Anexo III (5%-19.5%): serviços comuns — academia, clínica geral, etc.
 *
 * Anexo V (15.5%-30.5%): serviços intelectuais — fisioterapia/nutrição quando
 *   Fator R < 28% (folha/receita < 28%); cai pra III quando >= 28%.
 *
 * `valid_from`/`valid_to` permitem cálculo retroativo correto (contador
 * questiona apuração de mês passado → busca bracket vigente naquele
 * `year_month`).
 *
 * Seed inicial (12 rows = 6 brackets × 2 anexos) vigente desde 2026-01-01
 * vai em migration data 0050.
 */
export const fiscalSimplesBrackets = pgTable(
  'fiscal_simples_brackets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** 'III' (serviços comuns) | 'V' (serviços intelectuais — Fator R) */
    anexo: text('anexo').notNull(),
    /** 1..6 — faixa */
    bracket: integer('bracket').notNull(),
    /** Faixa inferior da RBT12 em centavos (>= este valor) */
    rbt12FromCents: bigint('rbt12_from_cents', { mode: 'number' }).notNull(),
    /** Faixa superior da RBT12 em centavos (< este valor). NULL = última faixa (sem teto interno). */
    rbt12ToCents: bigint('rbt12_to_cents', { mode: 'number' }),
    /** Alíquota nominal da faixa em basis points. 1500 = 15.00%. */
    aliquotaNominalBp: integer('aliquota_nominal_bp').notNull(),
    /** Parcela a deduzir em centavos. Aplicada na fórmula: (rbt12 × alíquota - parcela) / rbt12. */
    parcelaDeduzirCents: bigint('parcela_deduzir_cents', { mode: 'number' }).notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  (t) => [
    uniqueIndex('fiscal_simples_brackets_unique').on(t.anexo, t.bracket, t.validFrom),
    index('fiscal_simples_brackets_lookup_idx').on(t.anexo, t.validFrom),
    check('fiscal_simples_brackets_anexo_valid', sql`anexo IN ('III', 'V')`),
    check('fiscal_simples_brackets_bracket_range', sql`bracket >= 1 AND bracket <= 6`),
    check(
      'fiscal_simples_brackets_rbt12_range',
      sql`rbt12_to_cents IS NULL OR rbt12_to_cents > rbt12_from_cents`,
    ),
    check(
      'fiscal_simples_brackets_aliquota_range',
      sql`aliquota_nominal_bp > 0 AND aliquota_nominal_bp <= 10000`,
    ),
    check(
      'fiscal_simples_brackets_valid_to_after_from',
      sql`valid_to IS NULL OR valid_to > valid_from`,
    ),
  ],
)

export type FiscalRevenueAggregationRow = typeof fiscalRevenueAggregations.$inferSelect
export type FiscalRevenueAggregationInsert = typeof fiscalRevenueAggregations.$inferInsert
export type FiscalRevenueBreakdownRow = typeof fiscalRevenueBreakdown.$inferSelect
export type FiscalRevenueBreakdownInsert = typeof fiscalRevenueBreakdown.$inferInsert
export type FiscalSimplesBracketRow = typeof fiscalSimplesBrackets.$inferSelect
