/**
 * Nutri — Suplementação + Exames Laboratoriais — Sprint 30 Faixa A.
 *   (ADR 0082 esperado)
 *
 * 6 tabelas:
 *   - `supplements` (global LogiFit + tenant custom) — catálogo
 *   - `supplement_interactions` — pares (suplemento ↔ medicamento/outro suplemento) curados
 *   - `supplement_prescriptions` — prescrição ativa do member (polimórfica com Sprint 11
 *     via consulta_id; não usa prescriptions kind='supplement' porque posologia é específica)
 *   - `lab_analytes` (global LogiFit) — catálogo de analitos (glicose, vit D, TSH, etc.)
 *   - `lab_reference_ranges` (global) — 1:N por analito, com filtros sex/age/condition
 *   - `lab_results` (tenant) — resultados do member, com `out_of_range` calculado
 *
 * **Por que `supplements` separado de `foods`** (ADR 0082): posologia diferente
 *   (dose + frequência + duração em vez de gramas por refeição), regulamentação
 *   ANVISA (registration_code), interações medicamentosas, ato profissional
 *   diferente (prescrição médica/CRN vs lista de compras). Misturar com `foods`
 *   confunde domínios.
 *
 * **`lab_results.out_of_range bool`** denormalizado — calculado no INSERT via
 *   Server Action (consome `lab_reference_ranges` + idade/sexo do member); evita
 *   recálculo a cada query (filtro `WHERE out_of_range = true` em dashboards
 *   "exames alterados").
 *
 * **Particionamento** (regra 34 + ADR 0072):
 *   - `lab_results` previsão >6M/ano em base grande → PARTITION BY RANGE (collected_at)
 *     anual entra Sprint 30b quando volume validar. MVP single table.
 *   - Retenção 20 anos (Lei 13.787 + CFM 2.299) — 5a hot + 15a cold Parquet
 *
 * @volume_estimate_yearly: 6000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { consultas } from './fisio'
import { members } from './members'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const supplementKindEnum = pgEnum('supplement_kind', [
  'vitamin',
  'mineral',
  'fitoterapico',
  'aminoacid',
  'protein_powder',
  'blend',
  'omega',
  'probiotic',
  'enzyme',
  'pre_workout',
  'other',
])

export const supplementInteractionSeverityEnum = pgEnum('supplement_interaction_severity', [
  'info',
  'caution',
  'avoid',
])

export const supplementRouteEnum = pgEnum('supplement_route', [
  'oral',
  'sublingual',
  'topical',
  'injectable',
  'other',
])

export const supplementPrescriptionStatusEnum = pgEnum('supplement_prescription_status', [
  'active',
  'completed',
  'discontinued',
])

export const labAnalyteCategoryEnum = pgEnum('lab_analyte_category', [
  'bioquimico',
  'hematologico',
  'hormonal',
  'lipidograma',
  'vitamina_mineral',
  'inflamatorio',
  'metabolismo_oxidativo',
  'imunologico',
  'urina',
  'fezes',
  'outro',
])

export const referenceRangeSexEnum = pgEnum('reference_range_sex', ['any', 'male', 'female'])

export const labResultDirectionEnum = pgEnum('lab_result_direction', ['above', 'below'])

// ─── supplements (global + tenant) ──────────────────────────────────────

export const supplements = pgTable(
  'supplements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** NULL = global LogiFit; NOT NULL = custom do tenant */
    tenantId: uuid('tenant_id'),
    name: text('name').notNull(),
    nameNormalized: text('name_normalized').notNull(),
    kind: supplementKindEnum('kind').notNull(),
    /** Marca comercial — opcional pra entradas genéricas */
    brand: text('brand'),
    /** Concentração descritiva (ex: "1000UI", "500mg", "30bilhões UFC") */
    concentration: text('concentration'),
    /** Registro ANVISA (RDC 243/2018 — suplementos alimentares). Opcional pra global. */
    anvisaRegistration: text('anvisa_registration'),
    /** Indicação principal (ex: "Suplementação de vitamina D pra deficiência") */
    indication: text('indication'),
    /** Contraindicações conhecidas (texto livre) */
    contraindications: text('contraindications'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplements_tenant_kind_idx').on(t.tenantId, t.kind),
    index('supplements_global_idx')
      .on(t.kind, t.active)
      .where(sql`tenant_id IS NULL AND active = true AND archived_at IS NULL`),
    index('supplements_name_idx').on(t.nameNormalized),
    /** Unique global por (kind, name_normalized) pra evitar duplicar */
    uniqueIndex('supplements_global_name_uq')
      .on(t.kind, t.nameNormalized)
      .where(sql`tenant_id IS NULL`),
  ],
)

// ─── supplement_interactions (curadas) ──────────────────────────────────
/**
 * Pares de interação. `interacts_with` é texto livre — pode ser nome
 * comercial de medicamento ("Varfarina", "Sinvastatina") ou outro suplemento
 * ("Ferro", "Cálcio"). Caller faz match por similaridade no momento da
 * prescrição (Sprint 30b: lookup canônico com tabela de medicamentos).
 */
export const supplementInteractions = pgTable(
  'supplement_interactions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** NULL = curadoria global */
    tenantId: uuid('tenant_id'),
    supplementId: uuid('supplement_id')
      .notNull()
      .references(() => supplements.id, { onDelete: 'cascade' }),
    interactsWith: text('interacts_with').notNull(),
    interactsWithNormalized: text('interacts_with_normalized').notNull(),
    severity: supplementInteractionSeverityEnum('severity').notNull(),
    description: text('description').notNull(),
    /** Fonte (ACSM, OMS, Mayo Clinic, etc) */
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplement_interactions_supp_idx').on(t.supplementId, t.severity),
    index('supplement_interactions_lookup_idx').on(t.interactsWithNormalized, t.supplementId),
    /** Unique (supplement, interactsWith) — evita duplicar */
    uniqueIndex('supplement_interactions_uq')
      .on(t.tenantId, t.supplementId, t.interactsWithNormalized),
  ],
)

// ─── supplement_prescriptions ───────────────────────────────────────────
/**
 * Prescrição ativa do member. Mesmo padrão de polimorfismo com Sprint 20
 * (`consulta_id` opcional liga ato profissional). NÃO usa Sprint 11
 * `prescriptions kind='supplement'` porque posologia é específica (dose +
 * frequência + duração) e fluxo é distinto.
 */
export const supplementPrescriptions = pgTable(
  'supplement_prescriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    supplementId: uuid('supplement_id')
      .notNull()
      .references(() => supplements.id, { onDelete: 'restrict' }),
    /** Consulta de origem (Sprint 20). Opcional pra suplementos prescritos fora de consulta. */
    consultaId: uuid('consulta_id').references(() => consultas.id, {
      onDelete: 'set null',
    }),
    professionalUserId: uuid('professional_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Posologia: "2000UI", "500mg", "1 cápsula", etc. */
    dose: text('dose').notNull(),
    /** Frequência: "1x ao dia", "2x ao dia", "1x ao dia em jejum", etc. */
    frequency: text('frequency').notNull(),
    route: supplementRouteEnum('route').notNull().default('oral'),
    durationDays: integer('duration_days'),
    startedAt: date('started_at').notNull(),
    endedAt: date('ended_at'),
    status: supplementPrescriptionStatusEnum('status').notNull().default('active'),
    notes: text('notes'),
    discontinuedReason: text('discontinued_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supp_presc_tenant_member_idx').on(t.tenantId, t.memberId, t.startedAt),
    index('supp_presc_active_idx')
      .on(t.tenantId, t.memberId)
      .where(sql`status = 'active'`),
    index('supp_presc_consulta_idx').on(t.consultaId),
    check(
      'supp_presc_duration_positive',
      sql`${t.durationDays} IS NULL OR ${t.durationDays} > 0`,
    ),
    check(
      'supp_presc_ended_after_started',
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
)

// ─── lab_analytes (global) ──────────────────────────────────────────────

export const labAnalytes = pgTable(
  'lab_analytes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Code canônico (ex: 'glicose_jejum', 'vitamina_d_25oh', 'tsh') */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    category: labAnalyteCategoryEnum('category').notNull(),
    /** Unidade default (ex: 'mg/dL', 'ng/mL', 'mUI/L') */
    unit: text('unit').notNull(),
    description: text('description'),
    /** Métodos analíticos aceitos (texto livre — Sprint 30b: enum dedicado) */
    methods: text('methods'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lab_analytes_category_idx').on(t.category, t.active)],
)

// ─── lab_reference_ranges (global) ──────────────────────────────────────
/**
 * 1:N por analito. Múltiplas faixas suportam segmentações (sexo + faixa
 * etária + condição). Server Action `matchReferenceRange(analyteId, age, sex,
 * condition?)` escolhe a faixa mais específica.
 *
 * `min_value` / `max_value` ambos nullable porque alguns analitos têm
 * "ideal abaixo de X" (sem min) ou "ideal acima de X" (sem max). Lib pura
 * `isOutOfRange` lida com os 4 casos.
 */
export const labReferenceRanges = pgTable(
  'lab_reference_ranges',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    analyteId: uuid('analyte_id')
      .notNull()
      .references(() => labAnalytes.id, { onDelete: 'cascade' }),
    sex: referenceRangeSexEnum('sex').notNull().default('any'),
    ageMinYears: integer('age_min_years'),
    ageMaxYears: integer('age_max_years'),
    /** Condição filtro (ex: 'gestante', 'diabetico', 'atleta'); NULL = qualquer */
    condition: text('condition'),
    minValue: numeric('min_value', { precision: 12, scale: 3 }),
    maxValue: numeric('max_value', { precision: 12, scale: 3 }),
    notes: text('notes'),
    source: text('source'), // SBAC, Manual Merck, Mayo Clinic
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lab_ref_analyte_idx').on(t.analyteId, t.sex, t.ageMinYears),
    check(
      'lab_ref_at_least_one_bound',
      sql`${t.minValue} IS NOT NULL OR ${t.maxValue} IS NOT NULL`,
    ),
    check(
      'lab_ref_age_consistent',
      sql`${t.ageMinYears} IS NULL OR ${t.ageMaxYears} IS NULL OR ${t.ageMinYears} <= ${t.ageMaxYears}`,
    ),
  ],
)

// ─── lab_results (tenant + member) ──────────────────────────────────────

export const labResults = pgTable(
  'lab_results',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    analyteId: uuid('analyte_id')
      .notNull()
      .references(() => labAnalytes.id, { onDelete: 'restrict' }),
    value: numeric('value', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    collectedAt: date('collected_at').notNull(),
    laboratory: text('laboratory'),
    /** Vínculo opcional pra consulta interpretadora */
    consultaId: uuid('consulta_id').references(() => consultas.id, {
      onDelete: 'set null',
    }),
    /** Caminho do laudo PDF no MinIO (bucket `nutri-exames`); validação via scanUpload (regra 38) */
    attachmentStoragePath: text('attachment_storage_path'),
    /** Calculado no Server Action consumindo `lab_reference_ranges` + idade/sexo do member */
    outOfRange: boolean('out_of_range').notNull().default(false),
    outOfRangeDirection: labResultDirectionEnum('out_of_range_direction'),
    /** ID da reference_range que foi usada na avaliação (audit) */
    referenceRangeIdUsed: uuid('reference_range_id_used').references(() => labReferenceRanges.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    enteredByUserId: uuid('entered_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lab_results_tenant_member_idx').on(t.tenantId, t.memberId, t.collectedAt),
    index('lab_results_tenant_analyte_idx').on(t.tenantId, t.analyteId, t.collectedAt),
    /** Lookup quente "exames alterados recentes" */
    index('lab_results_out_of_range_idx')
      .on(t.tenantId, t.collectedAt)
      .where(sql`out_of_range = true`),
    index('lab_results_consulta_idx').on(t.consultaId),
    check(
      'lab_results_out_of_range_direction_consistent',
      sql`(out_of_range = false AND out_of_range_direction IS NULL) OR (out_of_range = true AND out_of_range_direction IS NOT NULL)`,
    ),
  ],
)

export type SupplementRow = typeof supplements.$inferSelect
export type SupplementInteractionRow = typeof supplementInteractions.$inferSelect
export type SupplementPrescriptionRow = typeof supplementPrescriptions.$inferSelect
export type LabAnalyteRow = typeof labAnalytes.$inferSelect
export type LabReferenceRangeRow = typeof labReferenceRanges.$inferSelect
export type LabResultRow = typeof labResults.$inferSelect
