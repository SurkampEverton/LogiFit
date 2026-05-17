/**
 * Avaliações físicas — Sprint 12 Faixa A (ADR 0024 esperado).
 *
 * 5 tabelas:
 *   - `assessment_types` (catálogo configurável; `tenant_id` nullable = template global,
 *     cobre composição corporal Academia + escalas funcionais Fisio + anamnese)
 *   - `assessments` (registro por member + type + versão snapshot do schema)
 *   - `assessment_measurements` (medições serializadas: value_num/text/enum por field_key)
 *   - `assessment_photos` (FK lógica pra Storage bucket privado)
 *   - `assessment_calculations` (cache de cálculos derivados — IMC, % gordura Pollock, TMB)
 *
 * **Schema dinâmico** (ADR 0024): `assessment_types.fields jsonb` declara
 * campos com `{key, label, kind, unit?, min?, max?, options?, weight?}`. Zod
 * dinâmico em runtime valida no INSERT. Permite tenant configurar tipos
 * próprios sem migration.
 *
 * **Biblioteca global** (`assessment_types.tenant_id IS NULL`): templates
 * curados LogiFit (3 tipos Academia + 8 escalas funcionais Fisio). Sprint 12
 * MVP seeda 3 Academia + EVA Fisio; demais escalas em Sprint 12+ próximo PR.
 *
 * **Categoria + Vertical** (`category`/`vertical` enums): UI filtra catálogo
 * por especialidade do profissional. Escalas funcionais (Oswestry/DASH/SF-36)
 * têm `category='escala_funcional'` + `scoring_method jsonb` com regras de
 * interpretação clínica + `clinical_reference text` (citação bibliográfica).
 *
 * **`assessment_measurements.source`**: pré-cabeada pra Sprint 34 Device Hub.
 * MVP `source='manual'`; quando Sprint 34 entregar Device Hub, `source='device'`
 * + `source_device_reading_id` + `validated_by_user_id` obrigatórios via
 * trigger.
 *
 * **`assessments.soft_deleted_at`**: audit-friendly. Trigger DELETE
 * preserva row (dado clínico = retenção COFFITO 20a + CFM 2.299).
 *
 * @volume_estimate_yearly: 1000000
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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const assessmentCategoryEnum = pgEnum('assessment_category', [
  'composicao_corporal', // bioimpedância, dobras 7, antropometria
  'escala_funcional', // Oswestry, DASH, Tampa, EVA, SF-36, Berg, TUG, WOMAC
  'anamnese', // questionário aberto
  'teste_funcional', // ROM, força, testes cardio
  'custom', // tenant define livre
])

export const assessmentVerticalEnum = pgEnum('assessment_vertical', [
  'academia',
  'fisio',
  'nutri',
])

export const measurementSourceEnum = pgEnum('measurement_source', [
  'manual', // profissional digitou
  'device', // Device Hub Sprint 34 (com source_device_reading_id obrigatório)
  'import_csv', // upload bulk CSV
])

export const photoKindEnum = pgEnum('assessment_photo_kind', [
  'front',
  'back',
  'side_left',
  'side_right',
  'custom',
])

// ─── assessment_types (catálogo + biblioteca global) ────────────────────
/**
 * `tenant_id` nullable: NULL = template global LogiFit (read-only via RLS),
 * NOT NULL = tipo customizado do tenant.
 *
 * `fields jsonb` formato:
 * ```json
 * [
 *   { "key": "peso_kg", "label": "Peso (kg)", "kind": "number", "unit": "kg", "min": 30, "max": 250 },
 *   { "key": "dobra_tricipital", "label": "Dobra Tricipital (mm)", "kind": "number", "unit": "mm", "min": 0, "max": 60 },
 *   { "key": "nivel_atividade", "label": "Nível atividade", "kind": "enum",
 *     "options": ["sedentario","leve","moderado","intenso"] },
 *   { "key": "queixa_principal", "label": "Queixa principal", "kind": "text" },
 *   { "key": "eva_dor", "label": "Intensidade dor (0-10)", "kind": "likert", "min": 0, "max": 10, "weight": 1 }
 * ]
 * ```
 *
 * `scoring_method jsonb` (escalas funcionais — null em outros tipos):
 * ```json
 * {
 *   "strategy": "sum" | "percent" | "domain",
 *   "domains": [{ "key": "fisico", "fields": ["q1","q2"] }],
 *   "interpretation": [
 *     { "range": [0, 20], "label": "Incapacidade mínima", "severity": "info" },
 *     { "range": [21, 40], "label": "Incapacidade moderada", "severity": "warning" }
 *   ]
 * }
 * ```
 *
 * `version int` + UPDATE cria nova row (Server Action `updateAssessmentType`).
 * Assessments antigas referenciam type_version snapshot pra preservar
 * histórico de schema.
 */
export const assessmentTypes = pgTable(
  'assessment_types',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** NULL = template global LogiFit (read-only via RLS) */
    tenantId: uuid('tenant_id'),
    name: text('name').notNull(),
    description: text('description'),
    vertical: assessmentVerticalEnum('vertical'),
    category: assessmentCategoryEnum('category').notNull(),
    /** Campos declarativos — Zod runtime valida assessments contra esse schema */
    fields: jsonb('fields').notNull(),
    /** Escalas funcionais: regra de pontuação + interpretação. Null em outros tipos. */
    scoringMethod: jsonb('scoring_method'),
    clinicalReference: text('clinical_reference'),
    version: integer('version').notNull().default(1),
    parentTypeId: uuid('parent_type_id'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assessment_types_tenant_category_idx')
      .on(t.tenantId, t.category)
      .where(sql`active = true AND archived_at IS NULL`),
    index('assessment_types_global_idx')
      .on(t.category)
      .where(sql`tenant_id IS NULL AND active = true AND archived_at IS NULL`),
    index('assessment_types_parent_idx').on(t.parentTypeId),
    check('assessment_types_version_positive', sql`${t.version} > 0`),
  ],
)

// ─── assessments (registro por member) ──────────────────────────────────
/**
 * 1 assessment = 1 sessão de avaliação. `type_version int` é snapshot:
 * mesmo se o tipo for editado depois, leitura antiga preserva schema
 * vigente no momento da medição.
 *
 * `soft_deleted_at`: trigger Server Action `deleteAssessment` preserva
 * row + grava audit_log. RLS lê soft_deleted_at IS NULL por padrão; admins
 * com permission `avaliacao.audit` veem tudo.
 *
 * Dado de saúde sensível (regra 29 + LGPD art. 11): leitura grava
 * `audit_log` automaticamente via `wrapServerAction`.
 */
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    assessmentTypeId: uuid('assessment_type_id')
      .notNull()
      .references(() => assessmentTypes.id, { onDelete: 'restrict' }),
    /** Snapshot version do type no momento da medição */
    typeVersion: integer('type_version').notNull(),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    performedByUserId: uuid('performed_by_user_id').references(() => users.id),
    notes: text('notes'),
    /** Soft-delete preserva audit (retenção COFFITO 20a / CFM 2.299) */
    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
    softDeleteReason: text('soft_delete_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assessments_tenant_member_idx').on(t.tenantId, t.memberId, t.performedAt),
    index('assessments_type_idx').on(t.assessmentTypeId),
    index('assessments_active_idx')
      .on(t.tenantId, t.memberId)
      .where(sql`soft_deleted_at IS NULL`),
  ],
)

// ─── assessment_measurements (séries por campo) ─────────────────────────
/**
 * 1 row por (assessment, field_key). `value_num`/`value_text`/`value_enum`
 * mutuamente exclusivos via check — campo `kind` do field_def define qual
 * coluna preencher.
 *
 * `source` pré-cabeada pra Device Hub (Sprint 34): MVP só `manual`. Trigger
 * pós-Sprint 34 valida que `source='device'` exige `validated_by_user_id`
 * + `source_device_reading_id`.
 */
export const assessmentMeasurements = pgTable(
  'assessment_measurements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    valueNum: numeric('value_num', { precision: 12, scale: 4 }),
    valueText: text('value_text'),
    valueEnum: text('value_enum'),
    source: measurementSourceEnum('source').notNull().default('manual'),
    /** FK lógica pra device_readings (Sprint 34 Device Hub) */
    sourceDeviceReadingId: uuid('source_device_reading_id'),
    validatedByUserId: uuid('validated_by_user_id').references(() => users.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assessment_measurements_unique').on(t.assessmentId, t.fieldKey),
    index('assessment_measurements_tenant_idx').on(t.tenantId, t.fieldKey),
    check(
      'assessment_measurements_has_value',
      sql`(${t.valueNum} IS NOT NULL) OR (${t.valueText} IS NOT NULL) OR (${t.valueEnum} IS NOT NULL)`,
    ),
    check(
      'assessment_measurements_device_requires_validation',
      sql`${t.source} <> 'device' OR (${t.validatedByUserId} IS NOT NULL AND ${t.validatedAt} IS NOT NULL)`,
    ),
  ],
)

// ─── assessment_photos (Storage references) ─────────────────────────────
/**
 * URL assinada curta (1h) gerada em runtime; nunca expor URL pública.
 * Bucket privado `assessments-photos` com criptografia at-rest server-side
 * (MinIO SSE-S3). Sprint 12 MVP entrega slot/schema; upload real aterrissa
 * com Storage adapter integration.
 */
export const assessmentPhotos = pgTable(
  'assessment_photos',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    kind: photoKindEnum('kind').notNull().default('custom'),
    /** Sprint 12 MVP: marcador. Sprint 38 scanUpload integra (regra 38). */
    scanStatus: text('scan_status').default('pending'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id),
  },
  (t) => [
    index('assessment_photos_assessment_idx').on(t.assessmentId),
    index('assessment_photos_tenant_idx').on(t.tenantId),
  ],
)

// ─── assessment_calculations (cache derivados) ──────────────────────────
/**
 * Cache de cálculos derivados (IMC, % gordura Pollock, TMB Mifflin-St Jeor,
 * RCQ). Server Action `createAssessment` chama calculadoras em
 * `@repo/db/avaliacoes/calc.ts` e popula.
 *
 * `calc_key` canônico — namespace consistente para widget/gráficos:
 *   - 'imc' (kg/m²)
 *   - 'pct_gordura_pollock7' (%)
 *   - 'pct_gordura_jackson_pollock' (%)
 *   - 'tmb_mifflin' (kcal/dia)
 *   - 'tmb_harris_benedict' (kcal/dia)
 *   - 'tmb_katch_mcardle' (kcal/dia)
 *   - 'rcq' (cintura/quadril ratio)
 *
 * Recalculado se `measurements` mudam: Sprint 12 simple — UPDATE
 * recreates rows. Sprint 12+: trigger AFTER UPDATE measurements.
 */
export const assessmentCalculations = pgTable(
  'assessment_calculations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    calcKey: text('calc_key').notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    /** Interpretação clínica derivada (ex: 'sobrepeso'/'obesidade_i'/'normal') */
    classification: text('classification'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assessment_calculations_unique').on(t.assessmentId, t.calcKey),
    index('assessment_calculations_tenant_key_idx').on(t.tenantId, t.calcKey),
  ],
)
