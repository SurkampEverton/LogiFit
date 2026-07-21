'use server'

/**
 * Server Actions de treinos — Sprint 11 Faixa B (ADR 0023 esperado).
 *
 * MVP:
 *   - createExercise / listExercises (catálogo do tenant + biblioteca global)
 *   - createWorkout + updateWorkout (versionado via parent_workout_id)
 *   - listWorkouts / getWorkout (com items expandidos)
 *   - prescribeWorkout — cria prescriptions kind=workout
 *   - listMemberPrescriptions / getActivePrescription
 *   - startSession / recordSessionItem / finishSession (preenche kcal via
 *     calculateKcalPerSession do @repo/db/treinos — ADR 0070)
 *
 * **Cross-prescrição alert** (regra 42 + ADR 0077): ADIADO Sprint 11+ — depende
 * de `getCrossTenantSummary()` (Sprint 02 pendência) + `meal_plans` (Sprint 29)
 * + `fisio_protocols` (Sprint 20). Stub `detectCrossPrescriptionConflicts`
 * retorna lista vazia no MVP, será expandido quando dependências aterrissarem.
 *
 * Regras consumidas:
 *   - regra 7 (Zod validation no boundary)
 *   - regra 33 (wrapServerAction → envelope ADR 0071 + audit_log)
 *   - regra 41 (ai-tools.ts registra subset whitelisted; ações destrutivas
 *     ficam ai-blocked — adiado pra Faixa D quando UI Camada 3 IA aterrissar)
 *   - regra 42 (cross-tenant read — placeholder stub)
 */

import { db } from '@repo/db/client'
import {
  exercises,
  members,
  prescriptions,
  workoutItems,
  workoutSessionItems,
  workoutSessions,
  workouts,
} from '@repo/db/schema'
import { calculateKcalPerSession } from '@repo/db/treinos'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const CreateExerciseInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  muscleGroups: z.array(z.string()).max(20).default([]),
  equipment: z.string().max(80).optional(),
  level: z.enum(['iniciante', 'intermediario', 'avancado']).default('iniciante'),
  metValue: z.number().positive().max(20),
  videoStoragePath: z.string().max(500).optional(),
  thumbnailUrl: z.string().url().max(500).optional(),
})

const ListExercisesInputSchema = z.object({
  search: z.string().max(120).optional(),
  level: z.enum(['iniciante', 'intermediario', 'avancado']).optional(),
  muscleGroup: z.string().max(40).optional(),
  includeGlobal: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(100),
})

const WorkoutItemInputSchema = z.object({
  exerciseId: z.string().uuid(),
  order: z.number().int().nonnegative(),
  sets: z.number().int().positive().max(20),
  reps: z.string().min(1).max(40),
  loadKg: z.number().nonnegative().max(999).optional(),
  restSeconds: z.number().int().nonnegative().max(3600).default(60),
  notes: z.string().max(500).optional(),
  supersetGroup: z.number().int().nonnegative().optional(),
})

const CreateWorkoutInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  goal: z.string().max(200).optional(),
  estimatedDurationMin: z.number().int().positive().max(360).optional(),
  items: z.array(WorkoutItemInputSchema).min(1).max(50),
})

const UpdateWorkoutInputSchema = z.object({
  workoutId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  goal: z.string().max(200).optional(),
  estimatedDurationMin: z.number().int().positive().max(360).optional(),
  items: z.array(WorkoutItemInputSchema).min(1).max(50),
})

const ListWorkoutsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
})

const GetWorkoutInputSchema = z.object({
  workoutId: z.string().uuid(),
})

const PrescribeWorkoutInputSchema = z.object({
  memberId: z.string().uuid(),
  workoutId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
})

const StartSessionInputSchema = z.object({
  prescriptionId: z.string().uuid(),
})

const RecordSessionItemInputSchema = z.object({
  sessionId: z.string().uuid(),
  workoutItemId: z.string().uuid(),
  setNumber: z.number().int().positive().max(20),
  repsPerformed: z.number().int().nonnegative().max(999).optional(),
  weightKg: z.number().nonnegative().max(999).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
})

const FinishSessionInputSchema = z.object({
  sessionId: z.string().uuid(),
  overallRpe: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(2000).optional(),
})

const ListMemberPrescriptionsInputSchema = z.object({
  memberId: z.string().uuid(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(20),
})

// ─── createExercise ───────────────────────────────────────────────────────

export const createExercise = wrapServerAction(
  { module: 'treinos', action: 'exercise.create', resourceType: 'exercises' },
  async (input: z.infer<typeof CreateExerciseInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateExerciseInputSchema.parse(input)
    const [row] = await db
      .insert(exercises)
      .values({
        tenantId: session.logifit.tenantId,
        name: parsed.name,
        description: parsed.description ?? null,
        muscleGroups: parsed.muscleGroups,
        equipment: parsed.equipment ?? null,
        level: parsed.level,
        metValue: parsed.metValue.toString(),
        videoStoragePath: parsed.videoStoragePath ?? null,
        thumbnailUrl: parsed.thumbnailUrl ?? null,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: exercises.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar exercício',
        request_id: '',
      })
    setAuditResource(row.id, { name: parsed.name, level: parsed.level })
    return { id: row.id }
  },
)

// ─── listExercises (tenant + biblioteca global) ───────────────────────────

export const listExercises = wrapServerAction(
  { module: 'treinos', action: 'exercise.list' },
  async (input: z.infer<typeof ListExercisesInputSchema>, { session }) => {
    const parsed = ListExercisesInputSchema.parse(input)

    // Filtro: tenant próprio + (opcionalmente) biblioteca global
    const tenantFilter = parsed.includeGlobal
      ? or(eq(exercises.tenantId, session.logifit.tenantId), isNull(exercises.tenantId))
      : eq(exercises.tenantId, session.logifit.tenantId)

    const conditions = [tenantFilter, eq(exercises.active, true), isNull(exercises.archivedAt)]
    if (parsed.level) conditions.push(eq(exercises.level, parsed.level))
    if (parsed.search) {
      // ILIKE simples — pós-MVP migra pra FTS / pg_trgm
      conditions.push(sql`${exercises.name} ILIKE ${'%' + parsed.search + '%'}`)
    }
    if (parsed.muscleGroup) {
      // array containment
      conditions.push(sql`${parsed.muscleGroup} = ANY(${exercises.muscleGroups})`)
    }

    const rows = await db
      .select({
        id: exercises.id,
        tenantId: exercises.tenantId,
        name: exercises.name,
        description: exercises.description,
        muscleGroups: exercises.muscleGroups,
        equipment: exercises.equipment,
        level: exercises.level,
        metValue: exercises.metValue,
        thumbnailUrl: exercises.thumbnailUrl,
        videoStoragePath: exercises.videoStoragePath,
      })
      .from(exercises)
      .where(and(...conditions))
      .orderBy(asc(exercises.name))
      .limit(parsed.limit)

    return { rows: rows.map((r) => ({ ...r, isGlobal: r.tenantId === null })) }
  },
)

// ─── createWorkout (com items) ────────────────────────────────────────────

export const createWorkout = wrapServerAction(
  { module: 'treinos', action: 'workout.create', resourceType: 'workouts' },
  async (input: z.infer<typeof CreateWorkoutInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateWorkoutInputSchema.parse(input)
    return await db.transaction(async (tx) => {
      const [w] = await tx
        .insert(workouts)
        .values({
          tenantId: session.logifit.tenantId,
          name: parsed.name,
          description: parsed.description ?? null,
          goal: parsed.goal ?? null,
          estimatedDurationMin: parsed.estimatedDurationMin ?? null,
          version: 1,
          parentWorkoutId: null,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: workouts.id })
      if (!w)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar workout',
          request_id: '',
        })

      // Insere items em batch
      await tx.insert(workoutItems).values(
        parsed.items.map((it) => ({
          tenantId: session.logifit.tenantId,
          workoutId: w.id,
          exerciseId: it.exerciseId,
          order: it.order,
          sets: it.sets,
          reps: it.reps,
          loadKg: it.loadKg?.toString() ?? null,
          restSeconds: it.restSeconds,
          notes: it.notes ?? null,
          supersetGroup: it.supersetGroup ?? null,
        })),
      )

      setAuditResource(w.id, { name: parsed.name, items_count: parsed.items.length })
      return { id: w.id, version: 1 }
    })
  },
)

// ─── updateWorkout (cria nova versão) ─────────────────────────────────────
/**
 * Versionamento: NÃO faz UPDATE — cria nova row workout com `version+1` e
 * `parent_workout_id` apontando pra original. Prescrições antigas seguem
 * referenciando workout_id imutável.
 *
 * Resolve `root_id` percorrendo parent_workout_id até chegar na raiz (version=1
 * com parent NULL). `version` na nova row é `max(version) WHERE root_chain` + 1.
 */
export const updateWorkout = wrapServerAction(
  { module: 'treinos', action: 'workout.update', resourceType: 'workouts' },
  async (input: z.infer<typeof UpdateWorkoutInputSchema>, { session, setAuditResource }) => {
    const parsed = UpdateWorkoutInputSchema.parse(input)
    return await db.transaction(async (tx) => {
      const [base] = await tx
        .select({ id: workouts.id, version: workouts.version })
        .from(workouts)
        .where(
          and(eq(workouts.id, parsed.workoutId), eq(workouts.tenantId, session.logifit.tenantId)),
        )
        .limit(1)
      if (!base)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Workout não encontrado',
          request_id: '',
        })

      const [w] = await tx
        .insert(workouts)
        .values({
          tenantId: session.logifit.tenantId,
          name: parsed.name,
          description: parsed.description ?? null,
          goal: parsed.goal ?? null,
          estimatedDurationMin: parsed.estimatedDurationMin ?? null,
          version: base.version + 1,
          parentWorkoutId: base.id,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: workouts.id, version: workouts.version })
      if (!w)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar nova versão',
          request_id: '',
        })

      await tx.insert(workoutItems).values(
        parsed.items.map((it) => ({
          tenantId: session.logifit.tenantId,
          workoutId: w.id,
          exerciseId: it.exerciseId,
          order: it.order,
          sets: it.sets,
          reps: it.reps,
          loadKg: it.loadKg?.toString() ?? null,
          restSeconds: it.restSeconds,
          notes: it.notes ?? null,
          supersetGroup: it.supersetGroup ?? null,
        })),
      )

      setAuditResource(w.id, {
        parent_id: parsed.workoutId,
        version: w.version,
        items_count: parsed.items.length,
      })
      return { id: w.id, version: w.version, parentId: parsed.workoutId }
    })
  },
)

// ─── listWorkouts ─────────────────────────────────────────────────────────

export const listWorkouts = wrapServerAction(
  { module: 'treinos', action: 'workout.list' },
  async (input: z.infer<typeof ListWorkoutsInputSchema>, { session }) => {
    const parsed = ListWorkoutsInputSchema.parse(input)
    const rows = await db
      .select({
        id: workouts.id,
        name: workouts.name,
        description: workouts.description,
        goal: workouts.goal,
        estimatedDurationMin: workouts.estimatedDurationMin,
        version: workouts.version,
        parentWorkoutId: workouts.parentWorkoutId,
        createdAt: workouts.createdAt,
      })
      .from(workouts)
      .where(and(eq(workouts.tenantId, session.logifit.tenantId), isNull(workouts.archivedAt)))
      .orderBy(desc(workouts.createdAt))
      .limit(parsed.limit)
    return { rows }
  },
)

// ─── getWorkout (com items expandidos) ────────────────────────────────────

export const getWorkout = wrapServerAction(
  { module: 'treinos', action: 'workout.get' },
  async (input: z.infer<typeof GetWorkoutInputSchema>, { session }) => {
    const parsed = GetWorkoutInputSchema.parse(input)
    const [w] = await db
      .select()
      .from(workouts)
      .where(
        and(eq(workouts.id, parsed.workoutId), eq(workouts.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!w)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Workout não encontrado',
        request_id: '',
      })

    const items = await db
      .select({
        id: workoutItems.id,
        exerciseId: workoutItems.exerciseId,
        order: workoutItems.order,
        sets: workoutItems.sets,
        reps: workoutItems.reps,
        loadKg: workoutItems.loadKg,
        restSeconds: workoutItems.restSeconds,
        notes: workoutItems.notes,
        supersetGroup: workoutItems.supersetGroup,
        exerciseName: exercises.name,
        exerciseMet: exercises.metValue,
        exerciseLevel: exercises.level,
        exerciseMuscleGroups: exercises.muscleGroups,
      })
      .from(workoutItems)
      .leftJoin(exercises, eq(exercises.id, workoutItems.exerciseId))
      .where(eq(workoutItems.workoutId, parsed.workoutId))
      .orderBy(asc(workoutItems.order))

    return { workout: w, items }
  },
)

// ─── prescribeWorkout ─────────────────────────────────────────────────────
/**
 * Cria prescription kind='workout' apontando pra workouts.id.
 *
 * **Cross-prescrição alert (ADR 0077)** ADIADO — depende getCrossTenantSummary
 * (Sprint 02 pendência) + meal_plans (Sprint 29) + fisio_protocols (Sprint 20).
 * MVP: cria prescrição sem checagem cross-tenant. Sprint 11+ próximo PR liga.
 */
export const prescribeWorkout = wrapServerAction(
  { module: 'treinos', action: 'prescription.create', resourceType: 'prescriptions' },
  async (input: z.infer<typeof PrescribeWorkoutInputSchema>, { session, setAuditResource }) => {
    const parsed = PrescribeWorkoutInputSchema.parse(input)

    // Sanity: member + workout pertencem ao tenant
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, session.logifit.tenantId)))
      .limit(1)
    if (!member)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    const [w] = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(
        and(
          eq(workouts.id, parsed.workoutId),
          eq(workouts.tenantId, session.logifit.tenantId),
          isNull(workouts.archivedAt),
        ),
      )
      .limit(1)
    if (!w)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Workout não encontrado ou arquivado',
        request_id: '',
      })

    const [p] = await db
      .insert(prescriptions)
      .values({
        tenantId: session.logifit.tenantId,
        memberId: parsed.memberId,
        kind: 'workout',
        refId: parsed.workoutId,
        startsAt: new Date(parsed.startsAt),
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        active: true,
        prescribedByUserId: session.logifit.userId,
        notes: parsed.notes ?? null,
      })
      .returning({ id: prescriptions.id })
    if (!p)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar prescrição',
        request_id: '',
      })

    setAuditResource(p.id, {
      member_id: parsed.memberId,
      workout_id: parsed.workoutId,
    })
    return { id: p.id }
  },
)

// ─── listMemberPrescriptions ──────────────────────────────────────────────

export const listMemberPrescriptions = wrapServerAction(
  { module: 'treinos', action: 'prescription.list_by_member' },
  async (input: z.infer<typeof ListMemberPrescriptionsInputSchema>, { session }) => {
    const parsed = ListMemberPrescriptionsInputSchema.parse(input)
    const conditions = [
      eq(prescriptions.tenantId, session.logifit.tenantId),
      eq(prescriptions.memberId, parsed.memberId),
    ]
    if (parsed.activeOnly) conditions.push(eq(prescriptions.active, true))

    const rows = await db
      .select({
        id: prescriptions.id,
        kind: prescriptions.kind,
        refId: prescriptions.refId,
        startsAt: prescriptions.startsAt,
        endsAt: prescriptions.endsAt,
        active: prescriptions.active,
        notes: prescriptions.notes,
        workoutName: workouts.name,
        workoutGoal: workouts.goal,
        workoutVersion: workouts.version,
      })
      .from(prescriptions)
      .leftJoin(
        workouts,
        and(eq(workouts.id, prescriptions.refId), eq(prescriptions.kind, 'workout')),
      )
      .where(and(...conditions))
      .orderBy(desc(prescriptions.createdAt))
      .limit(parsed.limit)

    return { rows }
  },
)

// ─── startSession ─────────────────────────────────────────────────────────

export const startSession = wrapServerAction(
  { module: 'treinos', action: 'session.start', resourceType: 'workout_sessions' },
  async (input: z.infer<typeof StartSessionInputSchema>, { session, setAuditResource }) => {
    const parsed = StartSessionInputSchema.parse(input)

    const [p] = await db
      .select({ id: prescriptions.id, memberId: prescriptions.memberId })
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.id, parsed.prescriptionId),
          eq(prescriptions.tenantId, session.logifit.tenantId),
          eq(prescriptions.active, true),
        ),
      )
      .limit(1)
    if (!p)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Prescrição não encontrada ou inativa',
        request_id: '',
      })

    const [s] = await db
      .insert(workoutSessions)
      .values({
        tenantId: session.logifit.tenantId,
        prescriptionId: parsed.prescriptionId,
        memberId: p.memberId,
      })
      .returning({ id: workoutSessions.id })
    if (!s)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao iniciar sessão',
        request_id: '',
      })

    setAuditResource(s.id, { prescription_id: parsed.prescriptionId })
    return { id: s.id }
  },
)

// ─── recordSessionItem ────────────────────────────────────────────────────

export const recordSessionItem = wrapServerAction(
  {
    module: 'treinos',
    action: 'session.record_item',
    resourceType: 'workout_session_items',
  },
  async (input: z.infer<typeof RecordSessionItemInputSchema>, { session, setAuditResource }) => {
    const parsed = RecordSessionItemInputSchema.parse(input)
    const [row] = await db
      .insert(workoutSessionItems)
      .values({
        tenantId: session.logifit.tenantId,
        sessionId: parsed.sessionId,
        workoutItemId: parsed.workoutItemId,
        setNumber: parsed.setNumber,
        repsPerformed: parsed.repsPerformed ?? null,
        weightKg: parsed.weightKg?.toString() ?? null,
        rpe: parsed.rpe ?? null,
      })
      .returning({ id: workoutSessionItems.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao registrar série',
        request_id: '',
      })
    setAuditResource(row.id, {
      session_id: parsed.sessionId,
      set: parsed.setNumber,
    })
    return { id: row.id }
  },
)

// ─── finishSession (preenche calculated_kcal) ─────────────────────────────
/**
 * Encerra sessão. Calcula `calculated_kcal` automaticamente:
 *   1. Busca todos workout_items do workout prescrito (via prescription → workout)
 *   2. MET ponderado pelos sets × peso member (fallback 70kg) × duration_min
 *   3. Resultado clampeado em [0, 5000] kcal
 *
 * Member.weightKg ainda não existe no schema (Sprint 12 antropometria) — usa
 * fallback 70kg. Quando Sprint 12 entregar, modificar pra ler última medição.
 */
export const finishSession = wrapServerAction(
  { module: 'treinos', action: 'session.finish', resourceType: 'workout_sessions' },
  async (input: z.infer<typeof FinishSessionInputSchema>, { session, setAuditResource }) => {
    const parsed = FinishSessionInputSchema.parse(input)
    return await db.transaction(async (tx) => {
      const [s] = await tx
        .select({
          id: workoutSessions.id,
          startedAt: workoutSessions.startedAt,
          finishedAt: workoutSessions.finishedAt,
          prescriptionId: workoutSessions.prescriptionId,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.id, parsed.sessionId),
            eq(workoutSessions.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!s)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Sessão não encontrada',
          request_id: '',
        })
      if (s.finishedAt)
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Sessão já encerrada',
          request_id: '',
        })

      // Resolve workout_id via prescription
      const [p] = await tx
        .select({ refId: prescriptions.refId, kind: prescriptions.kind })
        .from(prescriptions)
        .where(
          and(
            eq(prescriptions.id, s.prescriptionId),
            eq(prescriptions.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)

      let calculatedKcal: number | null = null
      if (p?.kind === 'workout' && p.refId) {
        const items = await tx
          .select({
            sets: workoutItems.sets,
            met: exercises.metValue,
          })
          .from(workoutItems)
          .leftJoin(exercises, eq(exercises.id, workoutItems.exerciseId))
          .where(
            and(
              eq(workoutItems.workoutId, p.refId),
              eq(workoutItems.tenantId, session.logifit.tenantId),
            ),
          )

        const finishedAt = new Date()
        const durationMin = Math.max(0, (finishedAt.getTime() - s.startedAt.getTime()) / 60000)

        const result = calculateKcalPerSession({
          items: items.map((it) => ({
            met: Number(it.met ?? 0),
            sets: it.sets,
          })),
          // Fallback 70kg até Sprint 12 antropometria
          weightKg: 70,
          durationMin,
        })
        calculatedKcal = result.kcal
      }

      const finishedAt = new Date()
      await tx
        .update(workoutSessions)
        .set({
          finishedAt,
          overallRpe: parsed.overallRpe ?? null,
          notes: parsed.notes ?? null,
          calculatedKcal: calculatedKcal !== null ? calculatedKcal.toString() : null,
        })
        .where(
          and(
            eq(workoutSessions.id, parsed.sessionId),
            eq(workoutSessions.tenantId, session.logifit.tenantId),
          ),
        )

      setAuditResource(parsed.sessionId, {
        overall_rpe: parsed.overallRpe,
        calculated_kcal: calculatedKcal,
      })
      return { id: parsed.sessionId, calculatedKcal }
    })
  },
)
