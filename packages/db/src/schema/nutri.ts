/**
 * Nutri — Banco de alimentos + plano alimentar — Sprint 29 Faixa A.
 *   (ADR 0080 + ADR 0081 esperados)
 *
 * 7 tabelas:
 *   - `foods` (global TACO/USDA + tenant custom) com `nutrients jsonb` Zod-validated
 *   - `food_measures` (medidas caseiras: "colher de sopa" → gramas)
 *   - `food_equivalences` (substituições isocalóricas curadas)
 *   - `meal_plans` (versionado via parent_meal_plan_id; polimórfico com Sprint 11 prescriptions kind='meal_plan')
 *   - `meal_plan_meals` (refeições: café, almoço, jantar, lanches, ceia)
 *   - `meal_items` (alimento + quantidade por refeição)
 *   - `tenant_branding` (logo + cores pra PDF — 1 row por tenant)
 *
 * **Nutrientes em jsonb** (ADR 0080): 30+ campos fixos validados via Zod
 *   (`packages/db/src/nutri/nutrients-schema.ts`). Alternativa 1:N foi rejeitada
 *   porque (a) volume nutricional é estático por alimento (não muda em runtime);
 *   (b) jsonb operator @> + index GIN cobrem todos os filtros nutricionais
 *   nos casos de uso reais; (c) facilita import/export TACO/USDA.
 *
 * **Versionamento `meal_plans`** (ADR 0081): editar plano ativo cria nova row
 *   com `version+1` e `parent_meal_plan_id` apontando pra raiz. Prescriptions
 *   antigas preservam ref_id imutável (regra Sprint 11). Job cron diário
 *   marca `active=false` quando expira.
 *
 * **`foods.tenant_id IS NULL`** = catálogo global LogiFit (TACO + USDA) read-only
 *   pra tenants. RLS policy especial permite SELECT global; INSERT/UPDATE só
 *   com tenant_id próprio. Curadoria global via `platform_admin` direto no banco
 *   (mesmo padrão Sprint 11 exercises globais).
 *
 * **Particionamento** (regra 34 + ADR 0072):
 *   - `foods` ~3000 globais + ~50 tenant médio = baixo volume; sem partitioning
 *   - `meal_items` previsão >2M/ano em base grande (1k tenants × 100 planos × 25 itens × 1 versão/mês × 12) → particionamento trimestral entra Sprint 29b se volume validar
 *
 * @volume_estimate_yearly: 2400000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { users } from './identity'
import { members } from './members'
import { prescriptions } from './treinos'

// ─── Enums ───────────────────────────────────────────────────────────────

export const foodSourceEnum = pgEnum('food_source', [
  'taco', // Tabela Brasileira de Composição de Alimentos
  'usda', // USDA FoodData Central (stretch)
  'custom', // tenant criou
])

export const foodCategoryEnum = pgEnum('food_category', [
  'cereais_e_derivados',
  'verduras_hortalicas',
  'frutas',
  'gorduras_e_oleos',
  'pescados_e_frutos_do_mar',
  'carnes_e_derivados',
  'leite_e_derivados',
  'bebidas',
  'ovos_e_derivados',
  'produtos_acucarados',
  'miscelaneos',
  'alimentos_industrializados',
  'leguminosas',
  'nozes_e_sementes',
  'preparacoes',
])

export const mealPlanGoalEnum = pgEnum('meal_plan_goal', [
  'emagrecimento',
  'ganho_massa',
  'manutencao',
  'baixo_carbo',
  'cetogenico',
  'vegetariano',
  'vegano',
  'diabetico',
  'renal',
  'gestante',
  'esportivo',
  'outro',
])

// ─── foods (catálogo global + tenant custom) ────────────────────────────
/**
 * `tenant_id` nullable: NULL = catálogo global LogiFit (TACO/USDA curado);
 * NOT NULL = alimento custom do tenant. RLS permite SELECT em ambos;
 * INSERT/UPDATE só na linha do tenant.
 *
 * `nutrients jsonb` schema mínimo (validado via Zod no Server Action):
 *   {
 *     kcal: number,
 *     protein_g: number,
 *     lipid_g: number,
 *     carbohydrate_g: number,
 *     fiber_g?: number,
 *     sodium_mg?: number,
 *     calcium_mg?: number,
 *     iron_mg?: number,
 *     vitamin_a_mcg?: number,
 *     vitamin_c_mg?: number,
 *     vitamin_d_mcg?: number,
 *     vitamin_b12_mcg?: number,
 *     ... 30+ campos opcionais
 *     // Todos os valores referem-se a 100g do alimento (base TACO).
 *   }
 *
 * `name_normalized` é `LOWER(unaccent(name))` pra full-text + filtros sem
 * acentuação. Sprint 29b: trigger PG popula automaticamente.
 *
 * `index GIN (name_normalized gin_trgm_ops)` pra busca fuzzy.
 * `index GIN (nutrients)` pra filtros nutricionais (ex: `nutrients @>
 * '{"protein_g": 15}'` pra alimentos com pelo menos 15g de proteína).
 */
export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL = global LogiFit; NOT NULL = tenant custom */
    tenantId: uuid('tenant_id'),
    source: foodSourceEnum('source').notNull(),
    /** Código TACO/USDA original quando aplicável (ex: TACO 'C0064') */
    externalCode: text('external_code'),
    name: text('name').notNull(),
    /** name lower + unaccent — Sprint 29b: trigger PG */
    nameNormalized: text('name_normalized').notNull(),
    category: foodCategoryEnum('category').notNull(),
    subcategory: text('subcategory'),
    /** Forma de preparo / consistência base (ex: 'cru', 'cozido', 'frito') */
    preparation: text('preparation'),
    /** 30+ nutrientes validados por Zod (lib `nutrients-schema.ts`) */
    nutrients: jsonb('nutrients').notNull(),
    /** Densidade pra conversão volumétrica (g/mL) — útil em líquidos */
    densityGPerMl: numeric('density_g_per_ml', { precision: 5, scale: 3 }),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: busca por name dentro do tenant ou global */
    index('foods_tenant_category_idx').on(t.tenantId, t.category),
    index('foods_global_idx')
      .on(t.category, t.active)
      .where(sql`tenant_id IS NULL AND active = true AND archived_at IS NULL`),
    /** GIN index pra full-text — Sprint 29b: requer pg_trgm + unaccent extensions */
    index('foods_name_normalized_idx').on(t.nameNormalized),
    /** Unique external_code dentro da fonte global pra evitar duplicar TACO */
    uniqueIndex('foods_external_uq')
      .on(t.source, t.externalCode)
      .where(sql`tenant_id IS NULL AND external_code IS NOT NULL`),
  ],
)

// ─── food_measures (medidas caseiras → gramas) ──────────────────────────
/**
 * Tradução de medida caseira pra gramas. Várias por food (ex: arroz tem
 * "colher de sopa cheia" = 25g e "xícara chá" = 80g).
 *
 * `measure` é texto livre — sem enum porque vocabulário é open-ended (cada
 * cultura tem suas medidas). Front-end mantém lista canônica sugerida.
 */
export const foodMeasures = pgTable(
  'food_measures',
  {
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    /** ex: "colher de sopa cheia", "xícara chá", "unidade média", "fatia fina" */
    measure: text('measure').notNull(),
    grams: numeric('grams', { precision: 8, scale: 2 }).notNull(),
    /** Ordem de exibição (1 = primário; mostra primeiro na UI) */
    displayOrder: integer('display_order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.foodId, t.measure] }),
    index('food_measures_food_idx').on(t.foodId, t.displayOrder),
    check('food_measures_grams_positive', sql`${t.grams} > 0`),
  ],
)

// ─── food_equivalences (substituições isocalóricas) ─────────────────────
/**
 * Pares de equivalência calórica + macro entre alimentos. Curados (não
 * calculados em runtime) — qualidade clínica importa: nutricionista escolhe
 * substituições que façam sentido (ex: arroz branco ↔ batata, mas não ↔ azeite).
 *
 * `category` agrupa por tipo (carbo/proteína/gordura) — UI mostra equivalentes
 * da mesma categoria primeiro.
 *
 * Direcional: A→B e B→A vivem como rows separadas (queries fica mais simples).
 * Seed gera ambas direções.
 */
export const foodEquivalences = pgTable(
  'food_equivalences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL = curadoria global LogiFit; NOT NULL = tenant override */
    tenantId: uuid('tenant_id'),
    foodIdA: uuid('food_id_a')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    foodIdB: uuid('food_id_b')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    gramsA: numeric('grams_a', { precision: 8, scale: 2 }).notNull(),
    gramsB: numeric('grams_b', { precision: 8, scale: 2 }).notNull(),
    /** Categoria semântica pro ranking */
    category: text('category').notNull(), // 'carbo' | 'proteina' | 'gordura' | 'mista'
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup: dado food A, busca todas as equivalências */
    index('food_equiv_a_idx').on(t.foodIdA, t.category),
    index('food_equiv_b_idx').on(t.foodIdB, t.category),
    /** Unique por (tenant, A, B) — evita duplicar */
    uniqueIndex('food_equiv_pair_uq').on(t.tenantId, t.foodIdA, t.foodIdB),
    check('food_equiv_grams_positive', sql`${t.gramsA} > 0 AND ${t.gramsB} > 0`),
    check('food_equiv_not_self', sql`${t.foodIdA} != ${t.foodIdB}`),
  ],
)

// ─── meal_plans (versionado + polimórfico via Sprint 11 prescriptions) ──
/**
 * Plano alimentar. Versionado via `parent_meal_plan_id` (Sprint 11 pattern):
 * editar = cria nova versão; prescription.refId antigo continua imutável
 * apontando pra versão antiga.
 *
 * `prescription_id` FK opcional pra `prescriptions` (Sprint 11) — quando o
 * plano é prescrito formalmente vira ato profissional. Pode existir como
 * draft sem prescription.
 */
export const mealPlans = pgTable(
  'meal_plans',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** FK opcional pra prescription Sprint 11 (kind='meal_plan'). Quando NULL
     *  o plano é draft (não prescrito ainda). */
    prescriptionId: uuid('prescription_id').references(() => prescriptions.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    goal: mealPlanGoalEnum('goal').notNull(),
    /** Meta calórica diária (kcal). Auto-pré-preenchido por TDEE do treino
     *  (Sprint 11 / ADR 0070) quando consent `nutri_sees_training` ativo. */
    targetKcal: integer('target_kcal'),
    /** Macros alvo em gramas */
    targetProteinG: numeric('target_protein_g', { precision: 6, scale: 1 }),
    targetCarbG: numeric('target_carb_g', { precision: 6, scale: 1 }),
    targetLipidG: numeric('target_lipid_g', { precision: 6, scale: 1 }),
    /** Observações gerais (anamnese alimentar / restrições) */
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    parentMealPlanId: uuid('parent_meal_plan_id'),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meal_plans_tenant_member_idx').on(t.tenantId, t.memberId, t.createdAt),
    index('meal_plans_active_idx')
      .on(t.tenantId, t.memberId)
      .where(sql`active = true AND archived_at IS NULL`),
    index('meal_plans_parent_idx').on(t.parentMealPlanId),
    check('meal_plans_version_positive', sql`${t.version} > 0`),
    check('meal_plans_ends_after_starts', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
  ],
)

// ─── meal_plan_meals (refeições dentro do plano) ─────────────────────────
/**
 * Refeições do plano (café, almoço, jantar, lanches, ceia). `order int`
 * controla sequência visual (não cronologia). `expected_time time nullable`
 * sugere horário (texto "manhã" / "tarde" fica em `notes`).
 */
export const mealPlanMeals = pgTable(
  'meal_plan_meals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    mealPlanId: uuid('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // ex: "Café da manhã", "Almoço", "Lanche tarde"
    expectedTime: time('expected_time'),
    order: integer('order').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meal_plan_meals_order_uq').on(t.mealPlanId, t.order),
    index('meal_plan_meals_plan_idx').on(t.mealPlanId),
  ],
)

// ─── meal_items (alimento + quantidade em refeição) ─────────────────────
/**
 * Item da refeição. `grams numeric` é fonte canônica; `measure text` opcional
 * é o que foi exibido na UI ("1 colher de sopa" = 25g de arroz).
 *
 * `food_id` aponta pra `foods.id` (pode ser global ou tenant). RLS via
 * `meal_plan_id → meal_plan_meals → meal_plans.tenant_id`.
 */
export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    mealId: uuid('meal_id')
      .notNull()
      .references(() => mealPlanMeals.id, { onDelete: 'cascade' }),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'restrict' }),
    /** Medida caseira que foi mostrada na UI (informativo); fonte canônica é grams */
    measure: text('measure'),
    grams: numeric('grams', { precision: 8, scale: 2 }).notNull(),
    notes: text('notes'),
    order: integer('order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meal_items_order_uq').on(t.mealId, t.order),
    index('meal_items_meal_idx').on(t.mealId),
    index('meal_items_food_idx').on(t.foodId),
    check('meal_items_grams_positive', sql`${t.grams} > 0`),
  ],
)

// ─── tenant_branding (logo + cores pro PDF) ──────────────────────────────
/**
 * 1 row por tenant. Usado pra geração de PDF do plano alimentar + outros
 * docs futuros (recibos, atestados). Logo/assinatura em MinIO (Sprint 26+).
 */
export const tenantBranding = pgTable('tenant_branding', {
  tenantId: uuid('tenant_id').primaryKey(),
  /** MinIO path pra logo (servido via signed URL) */
  logoStoragePath: text('logo_storage_path'),
  /** Hex color principal (default #3498DB = ev-primary) */
  primaryColor: text('primary_color').notNull().default('#3498DB'),
  /** Logo width em px no PDF (default 120) */
  logoWidthPx: integer('logo_width_px').notNull().default(120),
  /** MinIO path pra assinatura digitalizada (opcional, fora ICP-Brasil) */
  signatureStoragePath: text('signature_storage_path'),
  /** Nome do profissional padrão (footer do PDF) */
  professionalNameDefault: text('professional_name_default'),
  /** Texto livre pro rodapé (CNPJ + endereço + telefone) */
  footerText: text('footer_text'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type FoodRow = typeof foods.$inferSelect
export type FoodMeasureRow = typeof foodMeasures.$inferSelect
export type FoodEquivalenceRow = typeof foodEquivalences.$inferSelect
export type MealPlanRow = typeof mealPlans.$inferSelect
export type MealPlanMealRow = typeof mealPlanMeals.$inferSelect
export type MealItemRow = typeof mealItems.$inferSelect
export type TenantBrandingRow = typeof tenantBranding.$inferSelect
