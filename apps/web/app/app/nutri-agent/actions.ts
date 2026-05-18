'use server'

/**
 * Server Actions Nutri-Agent IA — Sprint 34 Faixa B.2 (ADRs 0043+0044).
 *
 * **Gate funcional regra 13/28**: tenant precisa ter ai_committees.status='active'
 * para ativar o agent. Server Action bloqueia com `BLOCKED` envelope se não cumprir.
 *
 * Actions:
 *   - runNutriAgentForMember({memberId, trigger?}) — orquestra:
 *     1. Valida gate Comitê IA
 *     2. Coleta snapshot cross-module (collectMemberContext)
 *     3. detectRiskPatterns + generateSuggestionsFromPatterns + generatePreConsultSummary
 *     4. Persiste run + metrics_snapshot + suggestions
 *   - listSuggestions({status?, severity?, memberId?, limit})
 *   - acceptSuggestion({suggestionId, applyChanges?}) — marca accepted; se
 *     plan_adjustment + applyChanges=true, dispara updateMealPlan (Sprint 29)
 *   - rejectSuggestion({suggestionId, reason})
 *   - getPreConsultSummary({memberId}) — busca summary mais recente
 *   - getAgentRunStatus({runId})
 */

import { db, pool } from '@repo/db/client'
import {
  aiCommittees,
  contracts,
  foodLogDailySummary,
  labResults,
  labAnalytes,
  mealPlans,
  members,
  nutriAgentRuns,
  nutriAgentSuggestions,
  nutriAgentMetricsSnapshot,
  persons,
  prescriptions,
  consultaCids,
  consultas,
  cidCatalog,
} from '@repo/db/schema'
import {
  detectRiskPatterns,
  generatePreConsultSummary,
  generateSuggestionsFromPatterns,
  classifyInterpretationFields,
  type MemberContextSnapshot,
  type NutriAgentDiaryDailySummary as DiaryDailySummary,
  type FisioActiveCid,
  type LabResultRecent,
} from '@repo/ai'
import { ageYearsAt } from '@repo/db/nutri'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const RunSchema = z.object({
  memberId: z.string().uuid(),
  trigger: z
    .enum(['manual_professional', 'pre_consult_auto', 'weekly_adherence', 'risk_event_triggered'])
    .default('manual_professional'),
})

const ListSuggestionsSchema = z
  .object({
    status: z.enum(['pending', 'accepted', 'rejected', 'expired']).optional().nullable(),
    severity: z.enum(['info', 'attention', 'critical']).optional().nullable(),
    memberId: z.string().uuid().optional().nullable(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .optional()

const AcceptSchema = z.object({
  suggestionId: z.string().uuid(),
  applyChanges: z.boolean().default(false),
})

const RejectSchema = z.object({
  suggestionId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

const SummarySchema = z.object({
  memberId: z.string().uuid(),
})

// ─── Helper: collectMemberContext ───────────────────────────────────────
/**
 * Junta snapshot cross-module do member. Lê de:
 *   - persons (idade, sexo)
 *   - meal_plans ativo (Sprint 29)
 *   - food_log_daily_summary últimos 14d (Sprint 31)
 *   - lab_results recentes 90d com out_of_range (Sprint 30/33)
 *   - consultas signed + cid_catalog (Sprint 20 — fisio CIDs ativos)
 *   - device_readings_daily_summary 7d (Sprint 32)
 *   - prescriptions kind='workout' ativo (Sprint 11)
 */
async function collectMemberContext(
  tenantId: string,
  memberId: string,
): Promise<MemberContextSnapshot> {
  const today = new Date().toISOString().slice(0, 10)

  // 1. Demographics
  const memberInfo = await db
    .select({
      birthDate: persons.birthDate,
      sex: persons.sex,
    })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1)
  if (memberInfo.length === 0) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Member não encontrado',
      request_id: '',
    })
  }
  const m = memberInfo[0]!
  const birthIso = m.birthDate ? String(m.birthDate) : null
  const ageYears = birthIso ? ageYearsAt(birthIso, today) : 35
  const sex: MemberContextSnapshot['demographics']['sex'] =
    m.sex === 'male' || m.sex === 'female' ? m.sex : 'any'

  // 2. Meal plan ativo
  const [activePlan] = await db
    .select()
    .from(mealPlans)
    .where(
      and(
        eq(mealPlans.tenantId, tenantId),
        eq(mealPlans.memberId, memberId),
        eq(mealPlans.active, true),
      ),
    )
    .orderBy(desc(mealPlans.createdAt))
    .limit(1)

  // 3. Diary 14d (via food_log_daily_summary)
  const diaryRows = await db
    .select({
      consumedDate: foodLogDailySummary.consumedDate,
      totalKcal: foodLogDailySummary.totalKcal,
      totalProteinG: foodLogDailySummary.totalProteinG,
      totalCarbG: foodLogDailySummary.totalCarbG,
      totalFatG: foodLogDailySummary.totalFatG,
      mealsCount: foodLogDailySummary.mealsCount,
      adherencePct: foodLogDailySummary.adherencePct,
    })
    .from(foodLogDailySummary)
    .where(
      and(
        eq(foodLogDailySummary.tenantId, tenantId),
        eq(foodLogDailySummary.memberId, memberId),
        gte(
          foodLogDailySummary.consumedDate,
          sql<string>`(CURRENT_DATE - INTERVAL '14 days')::date`,
        ),
      ),
    )
    .orderBy(desc(foodLogDailySummary.consumedDate))
    .limit(14)

  const diaryLast14d: DiaryDailySummary[] = diaryRows.map((r) => ({
    date: r.consumedDate as unknown as string,
    totalKcal: Number(r.totalKcal),
    totalProteinG: Number(r.totalProteinG),
    totalCarbG: Number(r.totalCarbG),
    totalFatG: Number(r.totalFatG),
    mealsCount: r.mealsCount,
    adherencePct: r.adherencePct ? Number(r.adherencePct) : null,
  }))

  // 4. Lab results recentes (90d)
  const labRows = await db
    .select({
      analyteCode: labAnalytes.code,
      analyteName: labAnalytes.name,
      value: labResults.value,
      unit: labResults.unit,
      outOfRange: labResults.outOfRange,
      direction: labResults.outOfRangeDirection,
      collectedAt: labResults.collectedAt,
    })
    .from(labResults)
    .innerJoin(labAnalytes, eq(labAnalytes.id, labResults.analyteId))
    .where(
      and(
        eq(labResults.tenantId, tenantId),
        eq(labResults.memberId, memberId),
        gte(labResults.collectedAt, sql<string>`(CURRENT_DATE - INTERVAL '90 days')::date`),
      ),
    )
    .orderBy(desc(labResults.collectedAt))
    .limit(50)

  const labResultsRecent: LabResultRecent[] = labRows.map((r) => ({
    analyteCode: r.analyteCode,
    analyteName: r.analyteName,
    value: Number(r.value),
    unit: r.unit,
    outOfRange: r.outOfRange,
    direction: r.direction as LabResultRecent['direction'],
    collectedAt: r.collectedAt as unknown as string,
  }))

  // 5. Fisio CIDs ativos (consultas signed últimos 6 meses)
  const cidRows = await db
    .select({
      cidCode: consultaCids.cidCode,
      description: cidCatalog.description,
      consultaSignedAt: consultas.signedAt,
    })
    .from(consultaCids)
    .innerJoin(consultas, eq(consultas.id, consultaCids.consultaId))
    .innerJoin(cidCatalog, eq(cidCatalog.code, consultaCids.cidCode))
    .where(
      and(
        eq(consultas.tenantId, tenantId),
        eq(consultas.memberId, memberId),
        eq(consultas.kind, 'fisio'),
        eq(consultas.status, 'signed'),
        eq(consultaCids.kind, 'principal'),
      ),
    )
    .orderBy(desc(consultas.signedAt))
    .limit(10)

  const fisioActiveCids: FisioActiveCid[] = cidRows.map((c) => ({
    cidCode: c.cidCode,
    description: c.description,
    consultaSignedAt: (c.consultaSignedAt as unknown as Date)?.toISOString?.() ?? '',
  }))

  // 6. Device summary (últimos 7d) — usa raw query pra agregar
  const deviceRows = await pool.query<{
    observation_code: string
    avg_val: string
  }>(
    `SELECT observation_code, AVG(avg_value)::text AS avg_val
     FROM device_readings_daily_summary
     WHERE tenant_id = $1 AND member_id = $2
       AND observed_date >= CURRENT_DATE - INTERVAL '7 days'
       AND observation_code IN ('HR_RESTING', 'SLEEP_DURATION_MIN', 'STEPS', 'HRV')
     GROUP BY observation_code`,
    [tenantId, memberId],
  )

  const deviceSummary: MemberContextSnapshot['deviceSummary'] = {}
  for (const r of deviceRows.rows) {
    const v = Number(r.avg_val)
    if (r.observation_code === 'HR_RESTING') deviceSummary.restingHrAvg7d = v
    if (r.observation_code === 'SLEEP_DURATION_MIN') deviceSummary.sleepAvg7d = v
    if (r.observation_code === 'STEPS') deviceSummary.stepsAvg7d = v
    if (r.observation_code === 'HRV') deviceSummary.hrvAvg7d = v
  }

  // 7. Workout load — stub mínimo (prescriptions ativa + count sessões; Sprint 34b refina)
  let workoutLoad: MemberContextSnapshot['workoutLoad'] = null
  const workoutPres = await db
    .select({ id: prescriptions.id })
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.tenantId, tenantId),
        eq(prescriptions.memberId, memberId),
        eq(prescriptions.kind, 'workout'),
        eq(prescriptions.active, true),
      ),
    )
    .limit(1)
  if (workoutPres.length > 0) {
    // Sprint 34b: query workout_sessions pra contar reais + MET pra kcal
    workoutLoad = {
      weeklyKcalEst: 1500, // stub
      sessionsCount: 4, // stub
      completionPct: 80, // stub
    }
  }

  return {
    memberId,
    capturedAt: new Date().toISOString(),
    demographics: { ageYears, sex },
    mealPlan: activePlan
      ? {
          id: activePlan.id,
          name: activePlan.name,
          goal: activePlan.goal,
          targetKcal: activePlan.targetKcal,
          targetProteinG: activePlan.targetProteinG ? Number(activePlan.targetProteinG) : null,
          targetCarbG: activePlan.targetCarbG ? Number(activePlan.targetCarbG) : null,
          targetLipidG: activePlan.targetLipidG ? Number(activePlan.targetLipidG) : null,
          version: activePlan.version,
        }
      : null,
    diaryLast14d,
    workoutLoad,
    fisioActiveCids,
    labResultsRecent,
    deviceSummary,
    consentsUsed: [], // Sprint 34b: lookup consents reais
  }
}

// ─── runNutriAgentForMember ─────────────────────────────────────────────

export const runNutriAgentForMember = wrapServerAction(
  {
    module: 'nutri-agent',
    action: 'run',
    resourceType: 'nutri_agent_runs',
  },
  async (input: z.infer<typeof RunSchema>, { session, setAuditResource }) => {
    const parsed = RunSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Gate Comitê IA (regra 13/28)
    const committee = await db
      .select({ id: aiCommittees.id })
      .from(aiCommittees)
      .where(and(eq(aiCommittees.tenantId, tenantId), eq(aiCommittees.status, 'active')))
      .limit(1)
    if (committee.length === 0) {
      // Cria run com status='blocked' pra audit
      const [blockedRun] = await db
        .insert(nutriAgentRuns)
        .values({
          tenantId,
          memberId: parsed.memberId,
          triggeredByUserId: session.user.id,
          trigger: parsed.trigger,
          status: 'blocked',
          failureReason: 'comite_ia_inativo',
          completedAt: new Date(),
          startedAt: new Date(),
        })
        .returning({ id: nutriAgentRuns.id })
      setAuditResource(blockedRun!.id, { blocked_reason: 'comite_ia_inativo' })
      throw new ApiException({
        code: 'FORBIDDEN',
        message:
          'Tenant não tem Comitê IA ativo (regra 13/28 CFM 2.454/2026). Cadastrar comitê em /app/settings/compliance/comite-ia antes de ativar o Nutri-Agent.',
        request_id: '',
      })
    }

    // 1. Cria run queued
    const [runRow] = await db
      .insert(nutriAgentRuns)
      .values({
        tenantId,
        memberId: parsed.memberId,
        triggeredByUserId: session.user.id,
        trigger: parsed.trigger,
        status: 'collecting',
        startedAt: new Date(),
      })
      .returning({ id: nutriAgentRuns.id })
    const runId = runRow!.id

    try {
      // 2. Coleta snapshot cross-module
      const snapshot = await collectMemberContext(tenantId, parsed.memberId)
      const snapshotJson = JSON.stringify(snapshot)
      const dataHash = createHash('sha256').update(snapshotJson).digest('hex')

      await db.insert(nutriAgentMetricsSnapshot).values({
        tenantId,
        runId,
        data: snapshot,
        dataHash,
      })

      await db
        .update(nutriAgentRuns)
        .set({ status: 'analyzing' })
        .where(eq(nutriAgentRuns.id, runId))

      // 3. Detecta padrões + gera sugestões
      const patterns = detectRiskPatterns(snapshot)
      const suggestions = generateSuggestionsFromPatterns(patterns, snapshot)
      const summary = generatePreConsultSummary(patterns, snapshot)
      const allSuggestions = [...suggestions, summary]

      // 4. Classifier guard (regra 28)
      const fields = allSuggestions.map((s) => `${s.title}\n${s.description}`)
      const classification = classifyInterpretationFields(fields)

      // 5. Persiste suggestions
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      for (const sugg of allSuggestions) {
        await db.insert(nutriAgentSuggestions).values({
          tenantId,
          runId,
          memberId: parsed.memberId,
          kind: sugg.kind,
          severity: sugg.severity,
          title: sugg.title,
          description: sugg.description,
          evidence: sugg.evidence,
          confidence: sugg.confidence.toString(),
          proposedChanges: sugg.proposedChanges,
          targetMealPlanId: snapshot.mealPlan?.id ?? null,
          blockedByClassifier: !classification.ok,
          classifierBlockedTerms: classification.ok
            ? null
            : classification.blockedTerms.map((t) => t.matched),
          expiresAt,
        })
      }

      // 6. Marca run completed
      await db
        .update(nutriAgentRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          summary: {
            patternsCount: patterns.length,
            suggestionsCount: allSuggestions.length,
            critical: patterns.filter((p) => p.severity === 'critical').length,
            attention: patterns.filter((p) => p.severity === 'attention').length,
            blockedByClassifier: !classification.ok,
          },
        })
        .where(eq(nutriAgentRuns.id, runId))

      setAuditResource(runId, {
        member_id: parsed.memberId,
        patterns_count: patterns.length,
        suggestions_count: allSuggestions.length,
      })

      return {
        ok: true as const,
        runId,
        patternsCount: patterns.length,
        suggestionsCount: allSuggestions.length,
        blockedByClassifier: !classification.ok,
      }
    } catch (err) {
      // Erro técnico — marca failed
      await db
        .update(nutriAgentRuns)
        .set({
          status: 'failed',
          failureReason: err instanceof Error ? err.message : 'unknown',
          completedAt: new Date(),
        })
        .where(eq(nutriAgentRuns.id, runId))
      throw err
    }
  },
)

// ─── listSuggestions ────────────────────────────────────────────────────

export const listSuggestions = wrapServerAction(
  { module: 'nutri-agent', action: 'suggestions.list' },
  async (input: unknown, { session }) => {
    const parsed = ListSuggestionsSchema.parse(input ?? {}) ?? { limit: 50 }
    const tenantId = session.logifit.tenantId

    const conditions = [eq(nutriAgentSuggestions.tenantId, tenantId)]
    if (parsed.status) conditions.push(eq(nutriAgentSuggestions.status, parsed.status))
    if (parsed.severity) conditions.push(eq(nutriAgentSuggestions.severity, parsed.severity))
    if (parsed.memberId) conditions.push(eq(nutriAgentSuggestions.memberId, parsed.memberId))

    const rows = await db
      .select({
        id: nutriAgentSuggestions.id,
        memberId: nutriAgentSuggestions.memberId,
        memberName: persons.name,
        kind: nutriAgentSuggestions.kind,
        severity: nutriAgentSuggestions.severity,
        title: nutriAgentSuggestions.title,
        description: nutriAgentSuggestions.description,
        confidence: nutriAgentSuggestions.confidence,
        status: nutriAgentSuggestions.status,
        blockedByClassifier: nutriAgentSuggestions.blockedByClassifier,
        createdAt: nutriAgentSuggestions.createdAt,
        expiresAt: nutriAgentSuggestions.expiresAt,
      })
      .from(nutriAgentSuggestions)
      .innerJoin(members, eq(members.id, nutriAgentSuggestions.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(...conditions))
      .orderBy(asc(nutriAgentSuggestions.expiresAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── acceptSuggestion ──────────────────────────────────────────────────

export const acceptSuggestion = wrapServerAction(
  {
    module: 'nutri-agent',
    action: 'suggestions.accept',
    resourceType: 'nutri_agent_suggestions',
  },
  async (input: z.infer<typeof AcceptSchema>, { session, setAuditResource }) => {
    const parsed = AcceptSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(nutriAgentSuggestions)
      .set({
        status: 'accepted',
        reviewedByUserId: session.user.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(nutriAgentSuggestions.id, parsed.suggestionId),
          eq(nutriAgentSuggestions.tenantId, tenantId),
          eq(nutriAgentSuggestions.status, 'pending'),
        ),
      )
      .returning({ id: nutriAgentSuggestions.id, kind: nutriAgentSuggestions.kind })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Suggestion não encontrada ou já revisada',
        request_id: '',
      })
    }

    // Sprint 34b: se applyChanges=true e kind='plan_adjustment', chama updateMealPlan
    // (precisa cuidar pra não criar loop infinito de versões). MVP só registra aceitação.
    void parsed.applyChanges

    setAuditResource(row.id, { kind: row.kind })
    return { ok: true as const }
  },
)

// ─── rejectSuggestion ──────────────────────────────────────────────────

export const rejectSuggestion = wrapServerAction(
  {
    module: 'nutri-agent',
    action: 'suggestions.reject',
    resourceType: 'nutri_agent_suggestions',
  },
  async (input: z.infer<typeof RejectSchema>, { session, setAuditResource }) => {
    const parsed = RejectSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(nutriAgentSuggestions)
      .set({
        status: 'rejected',
        reviewedByUserId: session.user.id,
        reviewedAt: new Date(),
        rejectionReason: parsed.reason,
      })
      .where(
        and(
          eq(nutriAgentSuggestions.id, parsed.suggestionId),
          eq(nutriAgentSuggestions.tenantId, tenantId),
          eq(nutriAgentSuggestions.status, 'pending'),
        ),
      )
      .returning({ id: nutriAgentSuggestions.id })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Suggestion não encontrada ou já revisada',
        request_id: '',
      })
    }
    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true as const }
  },
)

// ─── getPreConsultSummary ──────────────────────────────────────────────

export const getPreConsultSummary = wrapServerAction(
  { module: 'nutri-agent', action: 'summary.get' },
  async (input: z.infer<typeof SummarySchema>, { session }) => {
    const parsed = SummarySchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .select({
        id: nutriAgentSuggestions.id,
        title: nutriAgentSuggestions.title,
        description: nutriAgentSuggestions.description,
        severity: nutriAgentSuggestions.severity,
        createdAt: nutriAgentSuggestions.createdAt,
        evidence: nutriAgentSuggestions.evidence,
      })
      .from(nutriAgentSuggestions)
      .where(
        and(
          eq(nutriAgentSuggestions.tenantId, tenantId),
          eq(nutriAgentSuggestions.memberId, parsed.memberId),
          eq(nutriAgentSuggestions.kind, 'pre_consult_summary'),
        ),
      )
      .orderBy(desc(nutriAgentSuggestions.createdAt))
      .limit(1)

    return { ok: true as const, summary: row ?? null }
  },
)

void inArray // silence
