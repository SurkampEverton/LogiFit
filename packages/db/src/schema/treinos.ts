/**
 * Treinos — biblioteca de exercícios + workouts + prescrições + execução
 *   Sprint 11 Faixa A (ADR 0023 esperado).
 *
 * 6 tabelas:
 *   - `exercises` (catálogo; `tenant_id` nullable = biblioteca global compartilhada)
 *   - `workouts` (templates de treino por tenant — versionado via parent_workout_id)
 *   - `workout_items` (exercícios ordenados dentro de um workout + séries/reps/carga)
 *   - `prescriptions` (base **polimórfica**: kind ∈ {workout, meal_plan, fisio_protocol})
 *   - `workout_sessions` (execução: started/finished + RPE geral + kcal calculado)
 *   - `workout_session_items` (set-a-set: reps_performed, weight_kg, rpe por série)
 *
 * **Polimorfismo de prescriptions** (ADR 0023): `kind` enum + `ref_id uuid`
 * apontando pra tabela especializada (`workouts.id` quando kind=workout). Fisio
 * Sprint 20 cria `fisio_protocols`; Nutri Sprint 29 cria `meal_plans`. Mesma
 * abstração de "prescrever algo ao member com vigência" — sem migration
 * destrutiva quando verticais entrarem.
 *
 * **`exercises.met_value` obrigatório** (ADR 0070 + Sprint 11 Goal): valor MET
 * da Compendium of Physical Activities 2024. Usado por `calculateKcalPerSession`
 * em `packages/db/insights/workout.ts` pra preencher `workout_sessions.calculated_kcal`
 * automaticamente. Seed inicial: 20 exercícios curados.
 *
 * **Biblioteca global** (`exercises.tenant_id IS NULL`): templates curados pela
 * LogiFit, read-only pra tenants. Policy RLS especial permite SELECT global,
 * INSERT/UPDATE só com tenant_id próprio (curadoria via role `platform_admin`
 * fora do app, direto no banco no MVP).
 *
 * **Versionamento de workouts**: editar workout não muda row; cria nova com
 * `version+1` e `parent_workout_id` apontando pra original. Prescrições antigas
 * preservam ficha histórica.
 *
 * **Particionamento** (regra 34 + ADR 0072): `workout_sessions` previsão >5M
 * rows/ano (1k tenants × 1k members × 8 sessões/mês × 12) e `workout_session_items`
 * 10× isso (>80M). Particionar por `RANGE (started_at)` trimestral entra em
 * Sprint 12+ quando volume real justificar — MVP cabe sem.
 *
 * @volume_estimate_yearly: 5000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const exerciseLevelEnum = pgEnum('exercise_level', [
  'iniciante',
  'intermediario',
  'avancado',
])

export const prescriptionKindEnum = pgEnum('prescription_kind', [
  'workout', // ref_id → workouts.id (Sprint 11)
  'meal_plan', // ref_id → meal_plans.id (Sprint 29 futuro)
  'fisio_protocol', // ref_id → fisio_protocols.id (Sprint 20 futuro)
  'custom', // ref_id null + notes livre
])

// ─── exercises (catálogo + biblioteca global) ───────────────────────────
/**
 * `tenant_id` nullable: NULL = template global LogiFit, NOT NULL = biblioteca
 * do tenant. RLS policy especial em `0030_treinos_rls.sql` permite SELECT
 * global pra todo logifit_app; INSERT/UPDATE só com tenant_id próprio.
 *
 * `met_value` numeric obrigatório — Compendium 2024 MET. Usado pra cálculo
 * automático de kcal por sessão (ADR 0070). Faixa típica:
 *   - musculação leve: 3.5
 *   - musculação intensa: 6.0
 *   - aeróbico moderado: 7.0
 *   - HIIT: 8.0+
 *
 * `muscle_groups text[]` array de grupos musculares trabalhados (peitoral,
 * dorsal, quadriceps, etc) — busca por filtro no catálogo.
 *
 * `variations uuid[]` referencia outros exercises (ex: agachamento → variações
 * sumô/búlgaro). FK lógica (não relacional) pra evitar self-FK array.
 *
 * `equipment text` livre (barra/halteres/máquina/peso corporal). Curadoria
 * futura pode virar enum.
 *
 * `video_storage_path text nullable` aponta pra MinIO bucket `exercises`;
 * URL assinada gerada em runtime via `signExerciseVideo()` (Sprint 11 Faixa B).
 */
export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** NULL = template global LogiFit (read-only); NOT NULL = biblioteca do tenant */
    tenantId: uuid('tenant_id'),
    name: text('name').notNull(),
    description: text('description'),
    muscleGroups: text('muscle_groups').array().notNull().default(sql`'{}'::text[]`),
    equipment: text('equipment'),
    level: exerciseLevelEnum('level').notNull().default('iniciante'),
    /** MET Compendium 2024 — usado em calculateKcalPerSession */
    metValue: numeric('met_value', { precision: 4, scale: 2 }).notNull(),
    variations: uuid('variations').array().notNull().default(sql`'{}'::uuid[]`),
    videoStoragePath: text('video_storage_path'),
    thumbnailUrl: text('thumbnail_url'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exercises_tenant_active_idx').on(t.tenantId, t.active).where(sql`archived_at IS NULL`),
    index('exercises_global_idx')
      .on(t.active)
      .where(sql`tenant_id IS NULL AND active = true AND archived_at IS NULL`),
    check('exercises_met_positive', sql`${t.metValue} > 0`),
  ],
)

// ─── workouts (templates por tenant — versionado) ───────────────────────
/**
 * Ficha de treino — conjunto ordenado de exercícios (via `workout_items`).
 *
 * `version int` + `parent_workout_id uuid nullable`: editar workout NÃO faz
 * UPDATE — cria nova row com `version + 1` e `parent_workout_id` apontando
 * pra raiz. Prescrições antigas preservam ficha original (workout_id é FK
 * imutável). Server Action `updateWorkout` materializa esse padrão.
 *
 * `goal text` livre: hipertrofia / resistência / reabilitação / emagrecimento.
 * MVP texto livre; pós-MVP pode virar enum.
 *
 * `estimated_duration_min` informativo; cálculo automático em runtime via
 * sum(items.sets × items.rest_seconds) é alternativa Sprint 12+.
 */
export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    goal: text('goal'),
    estimatedDurationMin: integer('estimated_duration_min'),
    version: integer('version').notNull().default(1),
    parentWorkoutId: uuid('parent_workout_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workouts_tenant_active_idx').on(t.tenantId).where(sql`archived_at IS NULL`),
    index('workouts_parent_idx').on(t.parentWorkoutId),
    check('workouts_version_positive', sql`${t.version} > 0`),
  ],
)

// ─── workout_items (exercícios ordenados no workout) ────────────────────
/**
 * Item de ficha. Order int garante sequência. `reps text` aceita "10", "8-12",
 * "AMRAP", "até falha" — flexível por design (não cabe em int).
 *
 * `superset_group int nullable`: itens com mesmo número rodam em superset
 * (alternando sem descanso). NULL = exercício normal.
 *
 * `load_kg numeric nullable` — sugestão de carga; aluno registra carga real
 * em `workout_session_items.weight_kg`.
 */
export const workoutItems = pgTable(
  'workout_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    order: integer('order').notNull(),
    sets: integer('sets').notNull(),
    /** "10" | "8-12" | "AMRAP" | "até falha" — texto livre */
    reps: text('reps').notNull(),
    loadKg: numeric('load_kg', { precision: 6, scale: 2 }),
    restSeconds: integer('rest_seconds').notNull().default(60),
    notes: text('notes'),
    /** Itens com mesmo grupo rodam em superset alternado sem descanso */
    supersetGroup: integer('superset_group'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workout_items_workout_order_uq').on(t.workoutId, t.order),
    index('workout_items_workout_idx').on(t.workoutId),
    index('workout_items_exercise_idx').on(t.exerciseId),
    check('workout_items_sets_positive', sql`${t.sets} > 0`),
    check('workout_items_rest_non_negative', sql`${t.restSeconds} >= 0`),
    check('workout_items_load_non_negative', sql`${t.loadKg} IS NULL OR ${t.loadKg} >= 0`),
  ],
)

// ─── prescriptions (base polimórfica — ADR 0023) ────────────────────────
/**
 * Prescrição genérica ao member com vigência. `kind` enum + `ref_id uuid`
 * apontam pra tabela especializada:
 *   - kind='workout' → ref_id = workouts.id
 *   - kind='meal_plan' → ref_id = meal_plans.id (Sprint 29 futuro)
 *   - kind='fisio_protocol' → ref_id = fisio_protocols.id (Sprint 20 futuro)
 *   - kind='custom' → ref_id NULL, notes livre
 *
 * `active bool` derivado em runtime do `ends_at > now()` mas materializado
 * pra evitar timestamp arithmetic em query quente (widget perfil). Job
 * cron diário (Sprint 12+) zera active quando expira.
 *
 * Constraint `prescriptions_ref_required`: kind ≠ 'custom' exige ref_id
 * NOT NULL.
 *
 * FK lógica em `ref_id` (não relacional) pra suportar múltiplas tabelas alvo.
 * Server Action valida que `ref_id` existe na tabela apontada pelo kind.
 */
export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: prescriptionKindEnum('kind').notNull(),
    /** FK lógica: workouts.id quando kind=workout; meal_plans.id (futuro); etc */
    refId: uuid('ref_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    prescribedByUserId: uuid('prescribed_by_user_id').references(() => users.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prescriptions_tenant_member_idx').on(t.tenantId, t.memberId),
    index('prescriptions_kind_ref_idx').on(t.kind, t.refId),
    index('prescriptions_active_idx').on(t.tenantId, t.memberId).where(sql`active = true`),
    check('prescriptions_ref_required', sql`kind = 'custom' OR ref_id IS NOT NULL`),
    check(
      'prescriptions_ends_after_starts',
      sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
)

// ─── workout_sessions (execução) ────────────────────────────────────────
/**
 * Sessão executada de um workout prescrito. `calculated_kcal` preenchido
 * automaticamente em `finishSession` via `calculateKcalPerSession(met,
 * weight_kg, duration_min)` em `packages/db/insights/workout.ts` (ADR 0070).
 *
 * MET ponderado é média de MET dos exercises executados (workout_session_items
 * → workout_items → exercises.met_value). Peso vem de members.person → ?
 * (member não tem weight_kg; provisório usa fallback 70kg até Sprint 12
 * antropometria existir). Duration = finished_at − started_at.
 *
 * `overall_rpe int 1-10` — Borg CR-10 simplificado, capturado ao finalizar.
 *
 * Particionamento previsto trimestral (>5M/ano) — entra Sprint 12+.
 */
export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    overallRpe: integer('overall_rpe'),
    calculatedKcal: numeric('calculated_kcal', { precision: 8, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workout_sessions_tenant_member_idx').on(t.tenantId, t.memberId, t.startedAt),
    index('workout_sessions_prescription_idx').on(t.prescriptionId),
    index('workout_sessions_active_idx').on(t.tenantId, t.memberId).where(sql`finished_at IS NULL`),
    check(
      'workout_sessions_rpe_range',
      sql`${t.overallRpe} IS NULL OR (${t.overallRpe} >= 1 AND ${t.overallRpe} <= 10)`,
    ),
    check(
      'workout_sessions_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
)

// ─── workout_session_items (set-a-set) ──────────────────────────────────
/**
 * Registro por série. 1 row por (session_item, set_number).
 *
 * `reps_performed` pode divergir de `workout_items.reps` (aluno fez 8 quando
 * prescrito 10). `weight_kg` é a carga real registrada (cardápio progressivo).
 * `rpe int 1-10` por série — opcional; Sprint 11 captura overall_rpe na sessão.
 *
 * `done_at` permite gráfico de evolução temporal e cálculo de descanso real
 * (vs prescrito).
 */
export const workoutSessionItems = pgTable(
  'workout_session_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    workoutItemId: uuid('workout_item_id')
      .notNull()
      .references(() => workoutItems.id, { onDelete: 'restrict' }),
    setNumber: integer('set_number').notNull(),
    repsPerformed: integer('reps_performed'),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    rpe: integer('rpe'),
    doneAt: timestamp('done_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workout_session_items_unique').on(t.sessionId, t.workoutItemId, t.setNumber),
    index('workout_session_items_session_idx').on(t.sessionId),
    index('workout_session_items_workout_item_idx').on(t.workoutItemId),
    check('workout_session_items_set_positive', sql`${t.setNumber} > 0`),
    check(
      'workout_session_items_rpe_range',
      sql`${t.rpe} IS NULL OR (${t.rpe} >= 1 AND ${t.rpe} <= 10)`,
    ),
    check(
      'workout_session_items_weight_non_negative',
      sql`${t.weightKg} IS NULL OR ${t.weightKg} >= 0`,
    ),
    check(
      'workout_session_items_reps_non_negative',
      sql`${t.repsPerformed} IS NULL OR ${t.repsPerformed} >= 0`,
    ),
  ],
)
