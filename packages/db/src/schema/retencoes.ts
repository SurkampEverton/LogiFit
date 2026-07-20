/**
 * Retenções tributárias — Sprint 15b (ADR 0061 Grupos B e G; débito #5 da
 * auditoria 36b).
 *
 * 2 tabelas:
 *   - tax_natures — catálogo de naturezas (global curada LogiFit quando
 *     tenant_id IS NULL; custom do tenant quando preenchido). Regras em jsonb
 *     no shape de `RetentionRule[]` (@repo/ai/fiscal/retencoes)
 *   - tax_retentions — retenção calculada por (fonte, tributo), com o ciclo
 *     de guia (pending → paid → reconciled) que o contador acompanha
 *
 * O cálculo vive em `@repo/ai/fiscal/retencoes` (puro); estas tabelas só
 * persistem catálogo e resultado.
 *
 * @volume_estimate_yearly: 600000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const taxKindEnum = pgEnum('tax_kind', ['pis', 'cofins', 'csll', 'irrf', 'inss', 'iss'])

export const taxGuideStatusEnum = pgEnum('tax_guide_status', ['pending', 'paid', 'reconciled'])

export const taxNatures = pgTable(
  'tax_natures',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL = natureza global curada LogiFit (tenant não edita, só desativa) */
    tenantId: uuid('tenant_id'),
    code: text('code').notNull(),
    label: text('label').notNull(),
    /** 'ap' | 'professional_contract' | 'both' */
    appliesTo: text('applies_to').notNull().default('ap'),
    /** RetentionRule[] — shape validado por Zod na borda (@repo/ai) */
    rules: jsonb('rules').notNull(),
    regulatoryReference: text('regulatory_reference'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Global (tenant_id NULL) e custom por tenant coexistem com o mesmo code
    uniqueIndex('tax_natures_global_code_uq')
      .on(t.code)
      .where(sql`tenant_id IS NULL`),
    uniqueIndex('tax_natures_tenant_code_uq')
      .on(t.tenantId, t.code)
      .where(sql`tenant_id IS NOT NULL`),
    index('tax_natures_tenant_idx').on(t.tenantId).where(sql`active = true`),
    check('tax_natures_applies_to_valid', sql`applies_to IN ('ap','professional_contract','both')`),
  ],
)

export const taxRetentions = pgTable(
  'tax_retentions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    /** 'ap' | 'commission_entry' — polimórfico (ADR 0061) */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    taxNatureId: uuid('tax_nature_id').references(() => taxNatures.id, { onDelete: 'restrict' }),
    tax: taxKindEnum('tax').notNull(),
    baseCents: bigint('base_cents', { mode: 'number' }).notNull(),
    /** Alíquota EFETIVA aplicada em % (progressiva → efetiva) */
    rateAppliedPercent: numeric('rate_applied_percent', { precision: 7, scale: 4 }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** true = tenant é o responsável por recolher a guia */
    shouldWithhold: boolean('should_withhold').notNull().default(true),
    guideStatus: taxGuideStatusEnum('guide_status').notNull().default('pending'),
    /** Número da DARF/GPS colado pelo operador após pagar */
    guideReference: text('guide_reference'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** Competência 'YYYY-MM' — agrupa o relatório do contador */
    yearMonth: text('year_month').notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 retenção por tributo por fonte (ADR 0061)
    uniqueIndex('tax_retentions_source_tax_uq').on(t.sourceType, t.sourceId, t.tax),
    index('tax_retentions_tenant_month_idx').on(t.tenantId, t.yearMonth),
    index('tax_retentions_tenant_tax_idx').on(t.tenantId, t.tax, t.yearMonth),
    index('tax_retentions_pending_idx')
      .on(t.tenantId, t.guideStatus)
      .where(sql`guide_status = 'pending'`),
    check('tax_retentions_source_type_valid', sql`source_type IN ('ap','commission_entry')`),
    check('tax_retentions_amounts_non_negative', sql`base_cents >= 0 AND amount_cents >= 0`),
    check('tax_retentions_year_month_format', sql`year_month ~ '^\\d{4}-\\d{2}$'`),
    check('tax_retentions_paid_consistency', sql`(guide_status = 'pending') = (paid_at IS NULL)`),
  ],
)
