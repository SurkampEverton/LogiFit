/**
 * Cross-alert lesão Fisio → ajuste no treino Academia — Sprint 27 Faixa A (ADR 0084 esperado).
 *
 * 3 tabelas:
 *   - `cid_exercise_contraindications` — catálogo global LogiFit curado +
 *     tenant override (tenant_id nullable; NULL = global, NOT NULL = override).
 *     Mapeia CID → restrição em exercício específico OU grupo muscular OU padrão de
 *     movimento. Severidade: avoid / modify / caution.
 *   - `member_injury_alerts` — registro do alerta gerado quando CID de lesão
 *     marcada em consulta fisio; dispatcher avalia consent + franchise (regra 25)
 *     + contrato academia ativo + dispara ou bloqueia.
 *   - `workout_adaptations` — sugestão de modificação na ficha ativa do paciente;
 *     instrutor confirma / rejeita / sobrescreve. Aplicação cria nova versão do
 *     workout via `parent_workout_id` (versionamento Sprint 11).
 *
 * **Regra 25** (clínico nunca cruza company em franchise): dispatcher bloqueia
 * cross-alert antes de criar `member_injury_alerts` quando tenant.topology='franchise'
 * E `source_company_id` ≠ `target_company_id` (Academia). Audit registra
 * `blocked_reason='regra_25_franchise_cross_company'`.
 *
 * **Consent obrigatório**: paciente precisa de consent ativo
 * `cross_module_share` (CONSENT_CATALOG Sprint 26 lib pura). Sem consent →
 * `blocked_reason='consent_missing'`.
 *
 * **Severidade** (ADR 0084):
 *   - `avoid` — proibido durante recuperação (ex: agachamento pesado com lombalgia M54)
 *   - `modify` — permitido com adaptação (ex: trocar barra livre por máquina guiada)
 *   - `caution` — atenção redobrada, instrutor avalia em loco (ex: amplitude reduzida)
 *
 * @volume_estimate_yearly: 600000
 *   (1k tenants × 50 lesões/mês × 12 = ~600k injury_alerts + adaptations)
 *   Particionamento por mês se volume real ultrapassar — Sprint 27b avalia.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { cidCatalog, consultas } from './fisio'
import { exercises, workouts } from './treinos'
import { members } from './members'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const contraindicationSeverityEnum = pgEnum('contraindication_severity', [
  'avoid',
  'modify',
  'caution',
])

export const injuryAlertStatusEnum = pgEnum('injury_alert_status', [
  'pending_review', // criado, aguarda instrutor revisar adaptação
  'accepted', // instrutor confirmou (workout adaptado virou ativo)
  'rejected', // instrutor rejeitou (decisão clínica; manter workout original)
  'expired', // não revisado em 14 dias → expira (cron job)
  'blocked', // dispatcher bloqueou pré-criação (regra 25 / consent / sem academia)
])

export const adaptationStatusEnum = pgEnum('adaptation_status', [
  'suggested', // dispatcher gerou sugestão; aguarda instrutor
  'confirmed', // instrutor confirmou; adapted_workout_id criado (nova versão)
  'rejected', // instrutor rejeitou; original_workout_id segue ativo
  'manually_overridden', // instrutor editou e aplicou versão custom
])

// ─── cid_exercise_contraindications ─────────────────────────────────────
/**
 * Mapeamento CID → contraindicação. Granularidade:
 *   - Por exercise_id específico (mais preciso; ex: "agachamento pesado")
 *   - Por muscle_group (mais amplo; ex: bloqueia tudo que ativa "lombar")
 *   - Por movement_pattern (intermediário; ex: "flexao_lombar_carga")
 *
 * **Pelo menos UM** dos 3 deve ser NOT NULL (check constraint).
 *
 * `tenant_id NULL` = catálogo global LogiFit (read-only); `NOT NULL` = tenant
 * override (ex: clínica especializada adiciona contraindicações específicas
 * do protocolo deles). RLS policy permite SELECT em ambos; INSERT/UPDATE/DELETE
 * só na linha do tenant.
 *
 * `alternative_exercise_ids` aponta pra `exercises.id` (FK lógica, array sem
 * relacional pra simplificar). Server Action valida que IDs existem antes
 * de aplicar.
 */
export const cidExerciseContraindications = pgTable(
  'cid_exercise_contraindications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** NULL = global LogiFit; NOT NULL = tenant override (extensão local) */
    tenantId: uuid('tenant_id'),
    cidCode: text('cid_code')
      .notNull()
      .references(() => cidCatalog.code, { onDelete: 'restrict' }),
    /** FK opcional pra exercise específico */
    exerciseId: uuid('exercise_id').references(() => exercises.id, {
      onDelete: 'cascade',
    }),
    /** Grupo muscular afetado (ex: 'lombar', 'joelho', 'ombro'). Quando preenchido,
     *  o matcher avalia `exercises.muscle_groups @> ARRAY[muscle_group]`. */
    muscleGroup: text('muscle_group'),
    /** Padrão de movimento (ex: 'flexao_lombar_carga', 'rotacao_joelho_impacto').
     *  Stretch Sprint 27b: enum + tag em `exercises.movement_patterns`. MVP:
     *  texto livre + match exato com `exercises.metadata.movement_patterns`. */
    movementPattern: text('movement_pattern'),
    severity: contraindicationSeverityEnum('severity').notNull().default('caution'),
    /** Lista de exercises sugeridos como alternativa (FK lógica) */
    alternativeExerciseIds: uuid('alternative_exercise_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    rationale: text('rationale'),
    /** Fonte da curadoria (ex: 'COFFITO 414', 'ACSM 2023', 'curadoria LogiFit') */
    source: text('source'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Lookup quente: por CID — usado em detectContraindications */
    index('cid_contra_code_active_idx')
      .on(t.cidCode, t.active)
      .where(sql`active = true`),
    /** Lookup por tenant (overrides locais) */
    index('cid_contra_tenant_idx').on(t.tenantId, t.cidCode),
    /** Lookup global (tenant_id IS NULL) — biblioteca canônica */
    index('cid_contra_global_idx')
      .on(t.cidCode, t.active)
      .where(sql`tenant_id IS NULL AND active = true`),
    /** Unique global por (tenant_id, cid_code, exercise_id, muscle_group, movement_pattern)
     *  pra evitar duplicatas — usando expr index com COALESCE pra NULLs. */
    uniqueIndex('cid_contra_dedup_uq').on(
      t.tenantId,
      t.cidCode,
      sql`COALESCE(${t.exerciseId}::text, '')`,
      sql`COALESCE(${t.muscleGroup}, '')`,
      sql`COALESCE(${t.movementPattern}, '')`,
    ),
    /** Pelo menos um dos 3 must be NOT NULL */
    check(
      'cid_contra_at_least_one_target',
      sql`(${t.exerciseId} IS NOT NULL OR ${t.muscleGroup} IS NOT NULL OR ${t.movementPattern} IS NOT NULL)`,
    ),
  ],
)

// ─── member_injury_alerts ────────────────────────────────────────────────
/**
 * Alerta gerado por listener de `consulta.signed` Sprint 20 quando CID de lesão
 * marca consulta fisio. Dispatcher (Server Action `processInjuryAlert`) avalia
 * gates e CRIA esta row mesmo quando bloqueado (status='blocked' + blocked_reason)
 * pra fins de auditoria — toda tentativa fica gravada.
 *
 * **Status workflow:**
 *   pending_review → accepted (instrutor confirmou)
 *   pending_review → rejected (instrutor decidiu manter original)
 *   pending_review → expired (>14d sem revisão; cron job)
 *   blocked = terminal (nunca sai)
 *
 * **TTL via expires_at** = created_at + 14d. Job diário Sprint 27b marca
 * expired.
 *
 * **Particionamento** (regra 34): @volume_estimate_yearly 600k — fica num
 * range razoável sem particionamento MVP. Particionamento por mês entra
 * Sprint 27b quando volume validar.
 */
export const memberInjuryAlerts = pgTable(
  'member_injury_alerts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    sourceConsultaId: uuid('source_consulta_id')
      .notNull()
      .references(() => consultas.id, { onDelete: 'restrict' }),
    /** CID principal que disparou o alerta (consulta pode ter N CIDs;
     *  dispatcher pega o `kind='principal'` first). */
    primaryCidCode: text('primary_cid_code')
      .notNull()
      .references(() => cidCatalog.code, { onDelete: 'restrict' }),
    /** Lista de CIDs adicionais relevantes (jsonb pra simplicidade vs FK array) */
    secondaryCidCodes: jsonb('secondary_cid_codes'),
    /** Companies envolvidas — pra audit regra 25 */
    sourceCompanyId: uuid('source_company_id'), // clínica fisio (consulta)
    targetCompanyId: uuid('target_company_id'), // academia (workout)
    status: injuryAlertStatusEnum('status').notNull().default('pending_review'),
    /** Motivo do bloqueio (status='blocked'). Enum textual:
     *  - 'consent_missing' — sem cross_module_share ativo
     *  - 'regra_25_franchise_cross_company' — clínico nunca cruza company em franquia
     *  - 'no_active_academia_contract' — member não tem contrato Academia ativo
     *  - 'no_active_workout' — sem workout ativo pra adaptar
     *  - 'cid_not_actionable' — CID não tem contraindicações mapeadas */
    blockedReason: text('blocked_reason'),
    /** Consent usado (FK lógica pra member_consents Sprint 26) — null se blocked */
    consentIdUsed: uuid('consent_id_used'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('injury_alerts_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('injury_alerts_member_idx').on(t.memberId, t.createdAt),
    index('injury_alerts_consulta_idx').on(t.sourceConsultaId),
    /** Lookup quente: fila de instrutor (pending_review do tenant) */
    index('injury_alerts_pending_idx')
      .on(t.tenantId, t.expiresAt)
      .where(sql`status = 'pending_review'`),
    check(
      'injury_alerts_blocked_requires_reason',
      sql`(status != 'blocked' OR blocked_reason IS NOT NULL)`,
    ),
    check(
      'injury_alerts_reviewed_consistency',
      sql`(status NOT IN ('accepted', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))`,
    ),
  ],
)

// ─── workout_adaptations ────────────────────────────────────────────────
/**
 * Sugestão de adaptação de workout. 1:1 com `member_injury_alerts`
 * (criada junto quando alert.status != 'blocked'). Instrutor confirma → cria
 * novo workout via `updateWorkout` (Sprint 11 versionamento) e preenche
 * `adapted_workout_id`. `original_workout_id` continua existindo como
 * histórico — prescriptions antigas mantêm referência (regra Sprint 11).
 *
 * `changes jsonb` formato canônico:
 * ```json
 * {
 *   "removed": ["workout_item_id_1", "workout_item_id_2"],
 *   "replaced": [
 *     { "from_item_id": "...", "to_exercise_id": "...", "rationale": "..." }
 *   ],
 *   "added": [
 *     { "exercise_id": "...", "sets": 3, "reps": "10-12", "rationale": "..." }
 *   ],
 *   "summary": "Removido agachamento livre (M54.5 lombalgia avoid); substituído por leg press 45° (modify)."
 * }
 * ```
 *
 * Server Action `confirmAdaptation` materializa `adapted_workout_id` via
 * cópia do original + aplicação do diff + bump de version + parent_workout_id =
 * original. `prescriptions.refId` é atualizado em transação pra apontar pra
 * novo workout id.
 */
export const workoutAdaptations = pgTable(
  'workout_adaptations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => memberInjuryAlerts.id, { onDelete: 'cascade' }),
    originalWorkoutId: uuid('original_workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'restrict' }),
    /** Preenchido após confirm — workout versionado (Sprint 11 parent_workout_id) */
    adaptedWorkoutId: uuid('adapted_workout_id').references(() => workouts.id, {
      onDelete: 'set null',
    }),
    /** Diff canônico (ver doc acima) */
    changes: jsonb('changes').notNull().default(sql`'{}'::jsonb`),
    status: adaptationStatusEnum('status').notNull().default('suggested'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workout_adaptations_alert_uq').on(t.alertId),
    index('workout_adaptations_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('workout_adaptations_workout_idx').on(t.originalWorkoutId),
    check(
      'workout_adaptations_confirmed_consistency',
      sql`(status != 'confirmed' OR (confirmed_at IS NOT NULL AND adapted_workout_id IS NOT NULL))`,
    ),
  ],
)

export type CidExerciseContraindicationRow = typeof cidExerciseContraindications.$inferSelect
export type MemberInjuryAlertRow = typeof memberInjuryAlerts.$inferSelect
export type WorkoutAdaptationRow = typeof workoutAdaptations.$inferSelect
