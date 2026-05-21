/**
 * Feature flags — Sprint 02b7 (ADR 0098).
 *
 * Tabela GLOBAL (sem tenant_id) pra flags binárias on/off. Toggle hot via
 * UPDATE; helper `apps/web/app/lib/feature-flags.ts` faz cache 60s in-memory.
 *
 * metadata jsonb reservado pra evolução pós-MVP:
 *   - rollout_percentage (0-100)
 *   - tenant_overrides { [tenantId]: bool }
 *   - cohort (segmentos por plano/criação/etc)
 *
 * **Sem RLS** — policy 0060 só GRANT pra logifit_app. Mutação enforcer no
 * app layer via `requireRole('super_admin')` na Server Action de toggle
 * (UI admin Sprint 02b7+).
 */
import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const featureFlags = pgTable('feature_flags', {
  /** Slug do flag (lowercase + snake_case). Ex: 'passport_signup_v1' */
  key: text('key').primaryKey(),
  /** Nome amigável pra UI admin */
  name: text('name').notNull(),
  /** Descrição curta do que liga/desliga */
  description: text('description'),
  /** Estado atual on/off */
  enabled: boolean('enabled').notNull().default(false),
  /** Quando virou true (audit; null se nunca foi ativado) */
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  /** Reservado pra evolução: rollout %, tenant_overrides, cohort */
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type FeatureFlagRow = typeof featureFlags.$inferSelect
export type FeatureFlagInsert = typeof featureFlags.$inferInsert
