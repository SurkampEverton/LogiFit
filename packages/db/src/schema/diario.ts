/**
 * Diário Alimentar — Sprint 31 Faixa A.
 *
 * 3 tabelas:
 *   - `meal_log_entries` — paciente registra refeições reais (com foto opcional).
 *     **Particionamento por mês** (ADR 0072 + regra 34) Sprint 31b — MVP single table.
 *     @volume_estimate_yearly: 30M+ (1k tenants × 1k members × 5 refeições/dia × 365 ~ 1.8B no pior, MVP estima 30M).
 *     Retenção: 6 meses raw + agregado perpétuo em `food_log_daily_summary`.
 *   - `food_log_daily_summary` — agregado por (tenant, member, date); cron diário popula
 *     a partir de meal_log_entries. Alimenta `calculateCaloricBalance` ADR 0070.
 *   - `meal_log_reviews` — validações + comentários do nutricionista por entry.
 *
 * **Fluxo de cálculo**:
 *   1. Paciente cria `meal_log_entries` em `/meu/diario` (Sprint 26 portal)
 *   2. Server Action `logMeal` resolve `foods_structured` (items + grams) → calcula
 *      `calculated_nutrition jsonb` via lib pura `calc.ts` (reusa nutrients-schema Sprint 29)
 *   3. Cron diário 02:00 SP rolla rows do dia anterior em `food_log_daily_summary`
 *      (kcal/macros total + adherence_pct vs plano ativo)
 *   4. Widget "diário recente" em `/app/members/[id]` consome o summary
 *
 * **Adherence** = % dos items do plano ativo que o paciente cumpriu (>= 80% gramas).
 *
 * **Regra 25 (franchise)** aplica via tenant_id; clínico não cruza company em franquia.
 * Member portal Sprint 26: RLS member pode SELECT/INSERT/UPDATE só os próprios.
 *
 * @volume_estimate_yearly: 30000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { members } from './members'
import { mealPlans } from './nutri'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const mealReviewStatusEnum = pgEnum('meal_review_status', [
  'approved',
  'needs_adjustment',
  'flagged',
])

export const mealNameEnum = pgEnum('meal_name_enum', [
  'cafe',
  'lanche_manha',
  'almoco',
  'lanche_tarde',
  'jantar',
  'ceia',
  'pre_treino',
  'pos_treino',
  'outro',
])

// ─── meal_log_entries ────────────────────────────────────────────────────
/**
 * Refeição registrada pelo paciente. `foods_structured jsonb`:
 *   [
 *     { food_id: uuid, food_name: string, grams: number, measure?: string },
 *     ...
 *   ]
 *
 * `calculated_nutrition jsonb` cache:
 *   { kcal, protein_g, lipid_g, carbohydrate_g, items_count, total_grams }
 *
 * Foto opcional em MinIO bucket `diario-fotos` com scanUpload obrigatório
 * (regra 38). URL assinada TTL 10min via Server Action (Sprint 31b).
 */
export const mealLogEntries = pgTable(
  'meal_log_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Vínculo opcional com plano ativo (Sprint 29) pra calcular adherence */
    mealPlanId: uuid('meal_plan_id').references(() => mealPlans.id, {
      onDelete: 'set null',
    }),
    /** Data do consumo (não created_at) — pra agrupar por dia */
    consumedDate: date('consumed_date').notNull(),
    /** Refeição categorizada */
    mealName: mealNameEnum('meal_name').notNull(),
    /** Horário aproximado da refeição (opcional) */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Items estruturados (food_id + grams + measure?); nullable se só texto livre */
    foodsStructured: jsonb('foods_structured'),
    /** Texto livre alternativo (paciente não achou no catálogo) */
    freeTextDescription: text('free_text_description'),
    /** Foto via MinIO (scanUpload regra 38) */
    photoStoragePath: text('photo_storage_path'),
    /** Observação do paciente */
    notesMember: text('notes_member'),
    /** Cache nutricional (kcal/macros) calculado pelo Server Action */
    calculatedNutrition: jsonb('calculated_nutrition'),
    /** Status de revisão pelo nutri (cache do meal_log_reviews mais recente) */
    reviewStatus: mealReviewStatusEnum('review_status'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: por member + data desc (UI portal /meu/diario) */
    index('meal_log_member_date_idx').on(t.memberId, t.consumedDate.desc()),
    /** Lookup nutri (/app/members/[id]/diario) — por tenant + data */
    index('meal_log_tenant_date_idx').on(t.tenantId, t.consumedDate.desc()),
    /** Lookup "pendentes review" (nutri fila) */
    index('meal_log_pending_review_idx')
      .on(t.tenantId, t.createdAt.desc())
      .where(sql`review_status IS NULL`),
    /** Sanity: pelo menos uma fonte de items (estruturados OU texto livre) */
    check(
      'meal_log_has_content',
      sql`(${t.foodsStructured} IS NOT NULL OR ${t.freeTextDescription} IS NOT NULL OR ${t.photoStoragePath} IS NOT NULL)`,
    ),
  ],
)

// ─── food_log_daily_summary ──────────────────────────────────────────────
/**
 * Agregado diário (1 row por member×date). PK `(tenant_id, member_id, consumed_date)`.
 *
 * Job cron `aggregate-diary-daily-summary` (Sprint 31b) roda 02:00 SP e popula
 * a partir de meal_log_entries (group by member+date + sum macros + count meals
 * + calcula adherence_pct se mealPlanId está presente).
 *
 * Retenção: perpétuo (linhas pequenas ~100 bytes; 365k/tenant manageable).
 */
export const foodLogDailySummary = pgTable(
  'food_log_daily_summary',
  {
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    consumedDate: date('consumed_date').notNull(),
    /** Totais calculados (números arredondados) */
    totalKcal: numeric('total_kcal', { precision: 8, scale: 1 }).notNull().default('0'),
    totalProteinG: numeric('total_protein_g', { precision: 7, scale: 1 }).notNull().default('0'),
    totalCarbG: numeric('total_carb_g', { precision: 7, scale: 1 }).notNull().default('0'),
    totalFatG: numeric('total_fat_g', { precision: 7, scale: 1 }).notNull().default('0'),
    mealsCount: integer('meals_count').notNull().default(0),
    /** % de itens do plano que foram registrados (≥80% gramas) */
    adherencePct: numeric('adherence_pct', { precision: 5, scale: 2 }),
    /** ID do plano ativo no dia (denormalizado pra audit + group by) */
    mealPlanIdRef: uuid('meal_plan_id_ref'),
    /** Status do dia: 'logged' (algo registrado) | 'missed' (zero entries) */
    status: text('status').notNull().default('logged'),
    aggregatedAt: timestamp('aggregated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.consumedDate] }),
    /** Lookup pra widget perfil "última semana" */
    index('food_log_summary_member_date_idx').on(t.memberId, t.consumedDate.desc()),
    /** Range queries por tenant (relatórios agregados) */
    index('food_log_summary_tenant_date_idx').on(t.tenantId, t.consumedDate),
    check(
      'food_log_summary_adherence_pct_range',
      sql`${t.adherencePct} IS NULL OR (${t.adherencePct} >= 0 AND ${t.adherencePct} <= 100)`,
    ),
  ],
)

// ─── meal_log_reviews ────────────────────────────────────────────────────
/**
 * Validação / comentário do nutricionista por entry. 1:N (entry pode ter
 * múltiplos comentários se houver ida-e-volta). Status `approved`/
 * `needs_adjustment`/`flagged` materializado também em `meal_log_entries.review_status`
 * (cache do mais recente — Sprint 31b cron job atualiza).
 *
 * Apenas o nutri pode INSERT; member não vê estes (RLS).
 */
export const mealLogReviews = pgTable(
  'meal_log_reviews',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => mealLogEntries.id, { onDelete: 'cascade' }),
    reviewedByUserId: uuid('reviewed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: mealReviewStatusEnum('status').notNull(),
    comment: text('comment'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meal_log_reviews_entry_idx').on(t.entryId, t.reviewedAt.desc()),
    index('meal_log_reviews_tenant_user_idx').on(t.tenantId, t.reviewedByUserId, t.reviewedAt),
  ],
)

export type MealLogEntryRow = typeof mealLogEntries.$inferSelect
export type FoodLogDailySummaryRow = typeof foodLogDailySummary.$inferSelect
export type MealLogReviewRow = typeof mealLogReviews.$inferSelect

// Suprime warnings de imports não-usados em ambiente Drizzle
void boolean
void time
void uniqueIndex
