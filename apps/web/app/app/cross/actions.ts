'use server'

/**
 * Server Actions Cross-alert lesão Fisio → ajuste treino Academia.
 *   Sprint 27 Faixa B.2 (ADR 0084).
 *
 * Actions:
 *   - processInjuryAlert(consultaId) — dispatcher chamado pelo handler de
 *     `consulta.signed`; avalia gates + cria alert (status=pending OU blocked)
 *     + opcional adaptation suggested.
 *   - suggestWorkoutAdaptation(memberId, activeWorkoutId, cids) — gera diff
 *     de adaptação (lib pura) e cria `workout_adaptations` status='suggested'.
 *   - confirmAdaptation(adaptationId) — materializa nova versão do workout
 *     + atualiza prescription.refId em transação.
 *   - rejectAdaptation(adaptationId, reason) — fecha workflow sem aplicar.
 *   - listPendingAdaptations() — fila do instrutor.
 *   - listMyInjuryAlerts() — usado no portal /meu/alertas (membro).
 */

import { db } from '@repo/db/client'
import {
  type ContraindicationRule,
  type ExerciseInfo,
  type WorkoutItemInput,
  buildAdaptationDiff,
  canCrossModuleAlert,
  detectContraindications,
  isActionableCid,
} from '@repo/db/cross'
import {
  cidCatalog,
  cidExerciseContraindications,
  consultaCids,
  consultas,
  contracts,
  exercises,
  memberConsents,
  memberInjuryAlerts,
  members,
  prescriptions,
  tenants,
  workoutAdaptations,
  workoutItems,
  workouts,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const ProcessInjuryAlertInputSchema = z.object({
  consultaId: z.string().uuid(),
})

const SuggestAdaptationInputSchema = z.object({
  memberId: z.string().uuid(),
  /** Override do prescriptionId ativo (default: pega o mais recente) */
  prescriptionId: z.string().uuid().optional(),
  /** CIDs ativos (override do default: pega CIDs de consultas recentes do member) */
  cidCodes: z.array(z.string().min(1).max(20)).optional(),
})

const ConfirmAdaptationInputSchema = z.object({
  adaptationId: z.string().uuid(),
})

const RejectAdaptationInputSchema = z.object({
  adaptationId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

const ListPendingInputSchema = z.object({}).optional()

// ─── Helper: resolve company de origem (consulta) ────────────────────────

interface ConsultaContext {
  id: string
  tenantId: string
  companyId: string
  memberId: string
  kind: string
  status: string
}

async function loadConsultaContext(
  consultaId: string,
  tenantId: string,
): Promise<ConsultaContext | null> {
  const [row] = await db
    .select({
      id: consultas.id,
      tenantId: consultas.tenantId,
      companyId: consultas.companyId,
      memberId: consultas.memberId,
      kind: consultas.kind,
      status: consultas.status,
    })
    .from(consultas)
    .where(and(eq(consultas.id, consultaId), eq(consultas.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

async function loadActionableCids(
  consultaId: string,
): Promise<{ principal: string | null; secondary: string[] }> {
  const rows = await db
    .select({
      cidCode: consultaCids.cidCode,
      kind: consultaCids.kind,
      chapter: cidCatalog.chapter,
    })
    .from(consultaCids)
    .innerJoin(cidCatalog, eq(cidCatalog.code, consultaCids.cidCode))
    .where(eq(consultaCids.consultaId, consultaId))

  const actionable = rows.filter((r) => isActionableCid(r.chapter, r.cidCode))
  const principalRow = actionable.find((r) => r.kind === 'principal')
  const principal = principalRow?.cidCode ?? null
  const secondary = actionable.filter((r) => r.kind !== 'principal').map((r) => r.cidCode)
  return { principal, secondary }
}

async function loadActiveWorkout(
  memberId: string,
  tenantId: string,
): Promise<{
  prescriptionId: string
  workoutId: string
  companyId: string
  workoutItems: WorkoutItemInput[]
  exerciseLookup: Map<string, ExerciseInfo>
} | null> {
  const presRow = await db
    .select({
      id: prescriptions.id,
      refId: prescriptions.refId,
    })
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.tenantId, tenantId),
        eq(prescriptions.memberId, memberId),
        eq(prescriptions.kind, 'workout'),
        eq(prescriptions.active, true),
      ),
    )
    .orderBy(desc(prescriptions.startsAt))
    .limit(1)

  if (presRow.length === 0 || !presRow[0]!.refId) return null
  const workoutId = presRow[0]!.refId

  // Member company (target)
  const [memberRow] = await db
    .select({ companyId: members.companyId })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1)
  if (!memberRow) return null

  // Items + exercises
  const itemRows = await db
    .select({
      itemId: workoutItems.id,
      order: workoutItems.order,
      exerciseId: workoutItems.exerciseId,
      exerciseName: exercises.name,
      muscleGroups: exercises.muscleGroups,
    })
    .from(workoutItems)
    .innerJoin(exercises, eq(exercises.id, workoutItems.exerciseId))
    .where(eq(workoutItems.workoutId, workoutId))

  const exerciseLookup = new Map<string, ExerciseInfo>()
  const items: WorkoutItemInput[] = itemRows.map((r) => {
    const info: ExerciseInfo = {
      id: r.exerciseId,
      name: r.exerciseName,
      muscleGroups: r.muscleGroups ?? [],
      movementPatterns: [],
    }
    exerciseLookup.set(r.exerciseId, info)
    return {
      itemId: r.itemId,
      order: r.order,
      exerciseId: r.exerciseId,
      exerciseInfo: info,
    }
  })

  return {
    prescriptionId: presRow[0]!.id,
    workoutId,
    companyId: memberRow.companyId,
    workoutItems: items,
    exerciseLookup,
  }
}

async function loadContraindicationsForCids(
  cidCodes: string[],
  tenantId: string,
): Promise<ContraindicationRule[]> {
  if (cidCodes.length === 0) return []
  const rows = await db
    .select({
      id: cidExerciseContraindications.id,
      cidCode: cidExerciseContraindications.cidCode,
      tenantId: cidExerciseContraindications.tenantId,
      exerciseId: cidExerciseContraindications.exerciseId,
      muscleGroup: cidExerciseContraindications.muscleGroup,
      movementPattern: cidExerciseContraindications.movementPattern,
      severity: cidExerciseContraindications.severity,
      alternativeExerciseIds: cidExerciseContraindications.alternativeExerciseIds,
      rationale: cidExerciseContraindications.rationale,
      source: cidExerciseContraindications.source,
    })
    .from(cidExerciseContraindications)
    .where(
      and(
        inArray(cidExerciseContraindications.cidCode, cidCodes),
        eq(cidExerciseContraindications.active, true),
        or(
          isNull(cidExerciseContraindications.tenantId),
          eq(cidExerciseContraindications.tenantId, tenantId),
        ),
      ),
    )

  // Tenant overrides global pra mesma chave
  const byKey = new Map<string, ContraindicationRule & { isGlobal: boolean }>()
  for (const r of rows) {
    const k = [r.cidCode, r.exerciseId ?? '', r.muscleGroup ?? '', r.movementPattern ?? ''].join(
      '|',
    )
    const isGlobal = r.tenantId === null
    const existing = byKey.get(k)
    if (existing && !existing.isGlobal && isGlobal) continue // mantém o tenant override
    byKey.set(k, {
      id: r.id,
      cidCode: r.cidCode,
      exerciseId: r.exerciseId,
      muscleGroup: r.muscleGroup,
      movementPattern: r.movementPattern,
      severity: r.severity as ContraindicationRule['severity'],
      alternativeExerciseIds: r.alternativeExerciseIds ?? [],
      rationale: r.rationale,
      source: r.source,
      isGlobal,
    })
  }

  return Array.from(byKey.values()).map((r) => {
    const { isGlobal: _ig, ...rest } = r
    return rest
  })
}

async function hasActiveAcademiaContract(memberId: string, tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.tenantId, tenantId),
        eq(contracts.memberId, memberId),
        eq(contracts.status, 'active'),
      ),
    )
    .limit(1)
  return rows.length > 0
}

async function hasCrossModuleConsent(memberId: string): Promise<{
  ok: boolean
  consentId: string | null
}> {
  const rows = await db
    .select({ id: memberConsents.id, granted: memberConsents.granted })
    .from(memberConsents)
    .where(
      and(
        eq(memberConsents.memberId, memberId),
        eq(memberConsents.purpose, 'cross_module_share'),
        isNull(memberConsents.revokedAt),
      ),
    )
    .orderBy(desc(memberConsents.grantedAt))
    .limit(1)
  if (rows.length === 0) return { ok: false, consentId: null }
  return { ok: rows[0]!.granted, consentId: rows[0]!.id }
}

async function loadTenantTopology(tenantId: string): Promise<'owned' | 'franchise'> {
  const [row] = await db
    .select({ topology: tenants.topology })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return (row?.topology ?? 'owned') as 'owned' | 'franchise'
}

// ─── processInjuryAlert (dispatcher) ─────────────────────────────────────
/**
 * Disparado pelo handler de `consulta.signed` quando consulta fisio é assinada
 * com CID actionable. Avalia gates e cria `member_injury_alerts` mesmo quando
 * bloqueado (audit trail completo).
 *
 * Não é high-risk action — não exige MFA recente.
 */
export const processInjuryAlert = wrapServerAction(
  {
    module: 'cross',
    action: 'injury_alert.process',
    resourceType: 'member_injury_alerts',
  },
  async (input: z.infer<typeof ProcessInjuryAlertInputSchema>, { session, setAuditResource }) => {
    const parsed = ProcessInjuryAlertInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // 1. Carrega consulta
    const consulta = await loadConsultaContext(parsed.consultaId, tenantId)
    if (!consulta) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consulta não encontrada',
        request_id: '',
      })
    }
    if (consulta.kind !== 'fisio') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'processInjuryAlert só dispara em consultas fisio',
        request_id: '',
      })
    }
    if (consulta.status !== 'signed' && consulta.status !== 'locked') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Consulta precisa estar locked ou signed',
        request_id: '',
      })
    }

    // 2. CIDs actionable
    const cids = await loadActionableCids(consulta.id)
    if (!cids.principal) {
      // Cria registro de blocked status='blocked' + cid_not_actionable pra audit
      const [row] = await db
        .insert(memberInjuryAlerts)
        .values({
          tenantId,
          memberId: consulta.memberId,
          sourceConsultaId: consulta.id,
          primaryCidCode: 'XX99', // placeholder; constraint exige NOT NULL
          status: 'blocked',
          blockedReason: 'cid_not_actionable',
          sourceCompanyId: consulta.companyId,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: memberInjuryAlerts.id })
        .onConflictDoNothing()
      return {
        ok: true as const,
        alertId: row?.id ?? null,
        status: 'blocked',
        blockedReason: 'cid_not_actionable',
      }
    }

    // 3. Carrega workout ativo (target)
    const active = await loadActiveWorkout(consulta.memberId, tenantId)
    const targetCompanyId = active?.companyId ?? consulta.companyId

    // 4. Carrega consent + contrato + topology
    const consent = await hasCrossModuleConsent(consulta.memberId)
    const hasAcademia = await hasActiveAcademiaContract(consulta.memberId, tenantId)
    const topology = await loadTenantTopology(tenantId)

    // 5. Gate
    const decision = canCrossModuleAlert({
      topology,
      sourceCompanyId: consulta.companyId,
      targetCompanyId,
      hasConsent: consent.ok,
      hasActiveAcademiaContract: hasAcademia,
      hasActiveWorkout: active !== null,
    })

    if (!decision.ok) {
      const [row] = await db
        .insert(memberInjuryAlerts)
        .values({
          tenantId,
          memberId: consulta.memberId,
          sourceConsultaId: consulta.id,
          primaryCidCode: cids.principal,
          secondaryCidCodes: cids.secondary.length > 0 ? cids.secondary : null,
          status: 'blocked',
          blockedReason: decision.blockedReason,
          sourceCompanyId: consulta.companyId,
          targetCompanyId: active?.companyId ?? null,
          consentIdUsed: consent.consentId,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: memberInjuryAlerts.id })
      setAuditResource(row!.id, {
        blocked_reason: decision.blockedReason,
        topology,
        primary_cid: cids.principal,
      })
      return {
        ok: true as const,
        alertId: row!.id,
        status: 'blocked' as const,
        blockedReason: decision.blockedReason,
      }
    }

    // 6. Happy path: cria alert pending_review + adaptation suggested
    const [alertRow] = await db
      .insert(memberInjuryAlerts)
      .values({
        tenantId,
        memberId: consulta.memberId,
        sourceConsultaId: consulta.id,
        primaryCidCode: cids.principal,
        secondaryCidCodes: cids.secondary.length > 0 ? cids.secondary : null,
        status: 'pending_review',
        sourceCompanyId: consulta.companyId,
        targetCompanyId: active!.companyId,
        consentIdUsed: consent.consentId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: memberInjuryAlerts.id })

    // 7. Gera diff via lib pura
    const allCids = [cids.principal, ...cids.secondary]
    const contras = await loadContraindicationsForCids(allCids, tenantId)
    const detection = detectContraindications(allCids, active!.workoutItems, contras)
    const diff = buildAdaptationDiff({
      matches: detection.matches,
      exerciseLookup: active!.exerciseLookup,
    })

    const [adaptRow] = await db
      .insert(workoutAdaptations)
      .values({
        tenantId,
        alertId: alertRow!.id,
        originalWorkoutId: active!.workoutId,
        changes: {
          ...diff,
          primaryCidCode: cids.principal,
          secondaryCidCodes: cids.secondary,
          avoidCount: detection.avoidCount,
          modifyCount: detection.modifyCount,
          cautionCount: detection.cautionCount,
        },
        status: 'suggested',
      })
      .returning({ id: workoutAdaptations.id })

    setAuditResource(alertRow!.id, {
      primary_cid: cids.principal,
      adaptation_id: adaptRow!.id,
      avoid_count: detection.avoidCount,
      modify_count: detection.modifyCount,
      caution_count: detection.cautionCount,
    })

    return {
      ok: true as const,
      alertId: alertRow!.id,
      adaptationId: adaptRow!.id,
      status: 'pending_review' as const,
      summary: diff.summary,
      counts: {
        avoid: detection.avoidCount,
        modify: detection.modifyCount,
        caution: detection.cautionCount,
      },
    }
  },
)

// ─── suggestWorkoutAdaptation (re-roda dispatcher manualmente) ───────────

export const suggestWorkoutAdaptation = wrapServerAction(
  {
    module: 'cross',
    action: 'adaptation.suggest',
    resourceType: 'workout_adaptations',
  },
  async (input: z.infer<typeof SuggestAdaptationInputSchema>, { session, setAuditResource }) => {
    const parsed = SuggestAdaptationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const active = await loadActiveWorkout(parsed.memberId, tenantId)
    if (!active) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member sem workout ativo',
        request_id: '',
      })
    }

    const cids = parsed.cidCodes ?? []
    if (cids.length === 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Forneça pelo menos 1 CID ativo do paciente',
        request_id: '',
      })
    }

    const contras = await loadContraindicationsForCids(cids, tenantId)
    const detection = detectContraindications(cids, active.workoutItems, contras)
    const diff = buildAdaptationDiff({
      matches: detection.matches,
      exerciseLookup: active.exerciseLookup,
    })

    setAuditResource(active.workoutId, {
      avoid_count: detection.avoidCount,
      modify_count: detection.modifyCount,
      caution_count: detection.cautionCount,
    })

    return {
      ok: true as const,
      workoutId: active.workoutId,
      diff,
      counts: {
        avoid: detection.avoidCount,
        modify: detection.modifyCount,
        caution: detection.cautionCount,
      },
    }
  },
)

// ─── confirmAdaptation ───────────────────────────────────────────────────
/**
 * Materializa adapted_workout: cria nova versão do workout via cópia +
 * aplica diff (replaced) + atualiza prescriptions.refId em transação.
 *
 * **MVP**: lógica de diff `removed` ainda não remove item — Sprint 27b
 * implementa via `workout_items` delete. MVP só `replaced` (troca exercise_id).
 */
export const confirmAdaptation = wrapServerAction(
  {
    module: 'cross',
    action: 'adaptation.confirm',
    resourceType: 'workout_adaptations',
  },
  async (input: z.infer<typeof ConfirmAdaptationInputSchema>, { session, setAuditResource }) => {
    const parsed = ConfirmAdaptationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [adaptation] = await db
      .select({
        id: workoutAdaptations.id,
        alertId: workoutAdaptations.alertId,
        originalWorkoutId: workoutAdaptations.originalWorkoutId,
        changes: workoutAdaptations.changes,
        status: workoutAdaptations.status,
      })
      .from(workoutAdaptations)
      .where(
        and(
          eq(workoutAdaptations.id, parsed.adaptationId),
          eq(workoutAdaptations.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!adaptation) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Adaptação não encontrada',
        request_id: '',
      })
    }
    if (adaptation.status !== 'suggested') {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Adaptação já está em status ${adaptation.status}`,
        request_id: '',
      })
    }

    // Carrega workout original
    const [origWorkout] = await db
      .select()
      .from(workouts)
      .where(eq(workouts.id, adaptation.originalWorkoutId))
      .limit(1)
    if (!origWorkout) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Workout original não encontrado',
        request_id: '',
      })
    }

    // Cria nova versão (regra Sprint 11: parent_workout_id + version+1)
    const [newWorkout] = await db
      .insert(workouts)
      .values({
        tenantId,
        name: `${origWorkout.name} (adaptado p/ lesão)`,
        description: origWorkout.description,
        goal: origWorkout.goal,
        estimatedDurationMin: origWorkout.estimatedDurationMin,
        version: (origWorkout.version ?? 1) + 1,
        parentWorkoutId: origWorkout.id,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: workouts.id })

    // Copia workout_items aplicando diff
    const origItems = await db
      .select()
      .from(workoutItems)
      .where(eq(workoutItems.workoutId, origWorkout.id))
      .orderBy(workoutItems.order)

    const changes = adaptation.changes as {
      removed?: Array<{ itemId: string }>
      replaced?: Array<{ fromItemId: string; toExerciseId: string }>
    } | null

    const removedIds = new Set((changes?.removed ?? []).map((r) => r.itemId))
    const replaceMap = new Map((changes?.replaced ?? []).map((r) => [r.fromItemId, r.toExerciseId]))

    for (const it of origItems) {
      if (removedIds.has(it.id)) continue
      const newExerciseId = replaceMap.get(it.id) ?? it.exerciseId
      await db.insert(workoutItems).values({
        tenantId,
        workoutId: newWorkout!.id,
        exerciseId: newExerciseId,
        order: it.order,
        sets: it.sets,
        reps: it.reps,
        loadKg: it.loadKg,
        restSeconds: it.restSeconds,
        notes: it.notes,
        supersetGroup: it.supersetGroup,
      })
    }

    // Atualiza prescription ativa pra apontar pro novo workout (regra Sprint 11
    // ADR 0023: prescription.refId imutável → estratégia MVP: cria nova prescription
    // e marca antiga inactive).
    const [activePres] = await db
      .select()
      .from(prescriptions)
      .where(
        and(
          eq(prescriptions.tenantId, tenantId),
          eq(prescriptions.kind, 'workout'),
          eq(prescriptions.refId, origWorkout.id),
          eq(prescriptions.active, true),
        ),
      )
      .orderBy(desc(prescriptions.startsAt))
      .limit(1)

    if (activePres) {
      await db
        .update(prescriptions)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(prescriptions.id, activePres.id))
      await db.insert(prescriptions).values({
        tenantId,
        memberId: activePres.memberId,
        kind: 'workout',
        refId: newWorkout!.id,
        startsAt: new Date(),
        endsAt: activePres.endsAt,
        active: true,
        prescribedByUserId: session.logifit.userId,
        notes: `Adaptado por lesão (alerta ${adaptation.alertId.slice(0, 8)})`,
      })
    }

    // Marca adaptation confirmed + alert accepted
    await db
      .update(workoutAdaptations)
      .set({
        adaptedWorkoutId: newWorkout!.id,
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedByUserId: session.logifit.userId,
        updatedAt: new Date(),
      })
      .where(eq(workoutAdaptations.id, adaptation.id))

    await db
      .update(memberInjuryAlerts)
      .set({
        status: 'accepted',
        reviewedByUserId: session.logifit.userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(memberInjuryAlerts.id, adaptation.alertId))

    setAuditResource(adaptation.id, {
      original_workout_id: origWorkout.id,
      adapted_workout_id: newWorkout!.id,
      alert_id: adaptation.alertId,
    })

    return {
      ok: true as const,
      adaptedWorkoutId: newWorkout!.id,
      alertId: adaptation.alertId,
    }
  },
)

// ─── rejectAdaptation ────────────────────────────────────────────────────

export const rejectAdaptation = wrapServerAction(
  {
    module: 'cross',
    action: 'adaptation.reject',
    resourceType: 'workout_adaptations',
  },
  async (input: z.infer<typeof RejectAdaptationInputSchema>, { session, setAuditResource }) => {
    const parsed = RejectAdaptationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [adaptation] = await db
      .select({
        id: workoutAdaptations.id,
        alertId: workoutAdaptations.alertId,
        status: workoutAdaptations.status,
      })
      .from(workoutAdaptations)
      .where(
        and(
          eq(workoutAdaptations.id, parsed.adaptationId),
          eq(workoutAdaptations.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!adaptation) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Adaptação não encontrada',
        request_id: '',
      })
    }
    if (adaptation.status !== 'suggested') {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Adaptação já está em status ${adaptation.status}`,
        request_id: '',
      })
    }

    await db
      .update(workoutAdaptations)
      .set({
        status: 'rejected',
        rejectionReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(eq(workoutAdaptations.id, adaptation.id))

    await db
      .update(memberInjuryAlerts)
      .set({
        status: 'rejected',
        reviewedByUserId: session.logifit.userId,
        reviewedAt: new Date(),
        rejectionReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(eq(memberInjuryAlerts.id, adaptation.alertId))

    setAuditResource(adaptation.id, { reason: parsed.reason })
    return { ok: true as const, alertId: adaptation.alertId }
  },
)

// ─── listPendingAdaptations ──────────────────────────────────────────────

export const listPendingAdaptations = wrapServerAction(
  { module: 'cross', action: 'adaptation.list' },
  async (_input: unknown, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        adaptationId: workoutAdaptations.id,
        alertId: workoutAdaptations.alertId,
        originalWorkoutId: workoutAdaptations.originalWorkoutId,
        workoutName: workouts.name,
        changes: workoutAdaptations.changes,
        memberId: memberInjuryAlerts.memberId,
        primaryCidCode: memberInjuryAlerts.primaryCidCode,
        createdAt: workoutAdaptations.createdAt,
        expiresAt: memberInjuryAlerts.expiresAt,
      })
      .from(workoutAdaptations)
      .innerJoin(memberInjuryAlerts, eq(memberInjuryAlerts.id, workoutAdaptations.alertId))
      .innerJoin(workouts, eq(workouts.id, workoutAdaptations.originalWorkoutId))
      .where(
        and(eq(workoutAdaptations.tenantId, tenantId), eq(workoutAdaptations.status, 'suggested')),
      )
      .orderBy(desc(workoutAdaptations.createdAt))
      .limit(100)
    return { ok: true as const, rows }
  },
)

// ─── listAlertsForTenant ─────────────────────────────────────────────────

export const listInjuryAlerts = wrapServerAction(
  { module: 'cross', action: 'alert.list' },
  async (_input: unknown, { session }) => {
    const tenantId = session.logifit.tenantId
    const rows = await db
      .select({
        id: memberInjuryAlerts.id,
        memberId: memberInjuryAlerts.memberId,
        primaryCidCode: memberInjuryAlerts.primaryCidCode,
        status: memberInjuryAlerts.status,
        blockedReason: memberInjuryAlerts.blockedReason,
        sourceCompanyId: memberInjuryAlerts.sourceCompanyId,
        targetCompanyId: memberInjuryAlerts.targetCompanyId,
        createdAt: memberInjuryAlerts.createdAt,
        expiresAt: memberInjuryAlerts.expiresAt,
      })
      .from(memberInjuryAlerts)
      .where(eq(memberInjuryAlerts.tenantId, tenantId))
      .orderBy(desc(memberInjuryAlerts.createdAt))
      .limit(100)
    return { ok: true as const, rows }
  },
)

// Sprint 27b: `getAdaptationDetail`, `overrideAdaptation`, cron expire
// (status='expired' após 14d), integração com régua Sprint 13.
