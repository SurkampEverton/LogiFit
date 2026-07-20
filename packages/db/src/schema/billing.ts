/**
 * Billing de uso mensal — Sprint 04b (ADR 0102 + ADR 0066; débito do Sprint 04).
 *
 * `tenant_usage_snapshots` — 1 row por (tenant, year_month) com os agregados
 * das 4 cotas do plano comercial: members ativos, notas fiscais emitidas,
 * chamadas IA, storage. Escrita SOMENTE via job cron
 * (`POST /api/jobs/aggregate-usage-snapshots` — UPSERT idempotente,
 * recalculável); leitura pelo tenant (UI do plano) e super_admin.
 *
 * `ai_calls_count` e `storage_bytes` entram zerados no MVP (fase 2 pluga
 * ai_audit_log agregado + MinIO du) — UI trata 0 como "não medido".
 *
 * @volume_estimate_yearly: 12000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const tenantUsageSnapshots = pgTable(
  'tenant_usage_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    /** Competência 'YYYY-MM' */
    yearMonth: text('year_month').notNull(),
    activeMembersCount: integer('active_members_count').notNull().default(0),
    /** Notas cobradas (ADR 0066): completed nos kinds da lista fechada; eventos e self_entry não contam */
    fiscalEmissionsCount: integer('fiscal_emissions_count').notNull().default(0),
    aiCallsCount: integer('ai_calls_count').notNull().default(0),
    storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
    /** Última recomputação pelo job (roda N vezes no mês; UPSERT) */
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_usage_snapshots_tenant_month_uq').on(t.tenantId, t.yearMonth),
    index('tenant_usage_snapshots_month_idx').on(t.yearMonth),
    check('tus_year_month_format', sql`year_month ~ '^\\d{4}-\\d{2}$'`),
    check(
      'tus_counts_non_negative',
      sql`active_members_count >= 0 AND fiscal_emissions_count >= 0 AND ai_calls_count >= 0 AND storage_bytes >= 0`,
    ),
  ],
)
