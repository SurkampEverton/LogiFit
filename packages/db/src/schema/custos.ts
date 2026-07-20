/**
 * Custos operacionais — Sprint 14 Faixa A.
 *
 * 3 tabelas:
 *   - `cost_categories` (catálogo: aluguel/folha/marketing/manutenção/etc + tipo fixed/variable)
 *   - `cost_entries` (registros pontuais ou gerados por recorrência; com anexo NF-e opcional)
 *   - `recurring_costs` (template de recorrência mensal — gera entries via cron diário Sprint 14+)
 *
 * **Sem ADR novo** — categorias com `type` é estrutura trivial. Sprint 14 doc
 * confirma "não precisa novo ADR".
 *
 * **Scope per-company** (regra 21+25): cost_entries.company_id obrigatório.
 * Gerente de filial só vê custos da própria company; diretor vê todos.
 * Server Actions verificam via `has_permission()` (ADR 0019) — RLS pura
 * limita ao tenant.
 *
 * **Audit em leituras de DRE** (Sprint 14 doc): `generateDre` Server Action
 * é wrapped + emite `dre.generated` event pra audit_log — DRE é dado
 * administrativo sensível.
 *
 * @volume_estimate_yearly: 200000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const costCategoryTypeEnum = pgEnum('cost_category_type', [
  'fixed', // aluguel, folha CLT, software SaaS — previsível mensalmente
  'variable', // marketing, manutenção, água, energia — varia por mês
])

// ─── cost_categories ────────────────────────────────────────────────────
/**
 * Catálogo de categorias por tenant. `type` discrimina previsibilidade:
 *   - fixed: entra na previsão linear de despesa
 *   - variable: entra com média móvel 3 meses
 *
 * `icon text`: emoji ou ícone shadcn (ex: '🏢', '👥', '📣'). Usado em UI cards.
 *
 * `slug text` único por tenant pra referência estável em código/import CSV.
 */
export const costCategories = pgTable(
  'cost_categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    type: costCategoryTypeEnum('type').notNull(),
    icon: text('icon'),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cost_categories_tenant_slug_uq').on(t.tenantId, t.slug),
    index('cost_categories_tenant_type_idx').on(t.tenantId, t.type).where(sql`archived_at IS NULL`),
  ],
)

// ─── cost_entries ───────────────────────────────────────────────────────
/**
 * 1 row por desembolso. `incurred_at date` = quando o custo ocorreu (NÃO
 * created_at — pode registrar custo retroativo). DRE agrupa por
 * `incurred_at` no período selecionado.
 *
 * `recurring_cost_id nullable`: se vem de cron de recorrência, aponta pra
 * template. NULL = entrada manual.
 *
 * `attachment_storage_path text nullable`: NF-e PDF em MinIO bucket
 * privado `cost-attachments`. URL assinada em runtime. Sprint 38 integra
 * `scanUpload` (regra 38).
 */
export const costEntries = pgTable(
  'cost_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => costCategories.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    incurredAt: date('incurred_at').notNull(),
    description: text('description'),
    attachmentStoragePath: text('attachment_storage_path'),
    recurringCostId: uuid('recurring_cost_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cost_entries_tenant_company_at_idx').on(t.tenantId, t.companyId, t.incurredAt),
    index('cost_entries_category_at_idx').on(t.categoryId, t.incurredAt),
    index('cost_entries_recurring_idx').on(t.recurringCostId),
    check('cost_entries_amount_positive', sql`${t.amountCents} > 0`),
  ],
)

// ─── recurring_costs (templates de recorrência) ─────────────────────────
/**
 * Template mensal. Cron diário `recurring-tick` lê WHERE active=true AND
 * day_of_month=now().day AND (last_generated_at IS NULL OR last_generated_at < first_of_month)
 * e cria `cost_entries` para o (company, category, mês corrente).
 *
 * `day_of_month int 1-28`: evita problemas com fevereiro (28 dias). Custos
 * com dia 29-31 ficam Sprint 14+ (estratégia "último dia do mês").
 *
 * `ends_at date nullable`: NULL = indefinido; senão para de gerar após.
 */
export const recurringCosts = pgTable(
  'recurring_costs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => costCategories.id, { onDelete: 'restrict' }),
    amountCents: integer('amount_cents').notNull(),
    dayOfMonth: integer('day_of_month').notNull(),
    description: text('description'),
    startsAt: date('starts_at').notNull(),
    endsAt: date('ends_at'),
    lastGeneratedAt: date('last_generated_at'),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurring_costs_tenant_company_idx').on(t.tenantId, t.companyId),
    index('recurring_costs_active_idx').on(t.dayOfMonth).where(sql`active = true`),
    check('recurring_costs_amount_positive', sql`${t.amountCents} > 0`),
    check(
      'recurring_costs_day_of_month_range',
      sql`${t.dayOfMonth} >= 1 AND ${t.dayOfMonth} <= 28`,
    ),
    check(
      'recurring_costs_ends_after_starts',
      sql`${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`,
    ),
  ],
)
