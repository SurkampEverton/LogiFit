'use server'

/**
 * Server Actions Retenção/Churn — Sprint 19 Faixa B.2 (ADR 0027 Fase 1).
 *
 * Fase 1 = LLM Gemini via `task='classification'` (Sprint 06 + ADR 0064).
 * Quando GEMINI_API_KEY ausente / cota estourada / output inválido, cai pra
 * `heuristicPredict` (regra de defesa em profundidade — ADR 0064 + ADR 0027).
 *
 * MVP entrega:
 *   - scorePredict(memberId) — sob demanda; cache via snapshot_hash
 *   - listAtRiskMembers(limit) — top N por prob_30d (com inner join member)
 *   - assignIntervention(memberId, predictionId, action, notes, assignedToUserId)
 *   - closeIntervention(interventionId, outcome, outcomeNotes)
 *   - feedbackCancellation(memberId, reason, reasonDetail?)
 *   - getModelStats() — accuracy/precision/recall agregados (precisa de churn_events com was_predicted)
 *
 * Job daily `/api/jobs/churn/recalculate-daily` (não criado no MVP — feature
 * flag rolling pos-piloto) chama `scorePredict` em batch.
 */

import {
  computeFeatures,
  hashFeatures,
  type ChurnFeatures,
  type ChurnPrediction,
  heuristicPredict,
  predictChurn,
} from '@repo/db/retencao'
import { db } from '@repo/db/client'
import {
  accessEvents,
  appointments,
  churnEvents,
  churnFeaturesSnapshot,
  churnInterventions,
  churnPredictions,
  contracts,
  goals,
  invoices,
  memberAchievements,
  members,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const ScorePredictInputSchema = z.object({
  memberId: z.string().uuid(),
  /** Quando true, recomputa mesmo que features inalteradas (forçar refresh) */
  force: z.boolean().default(false),
})

const ListAtRiskInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  band: z.enum(['low', 'medium', 'high', 'all']).default('high'),
})

const AssignInterventionInputSchema = z.object({
  predictionId: z.string().uuid(),
  assignedToUserId: z.string().uuid(),
  action: z.enum([
    'phone_call',
    'whatsapp_message',
    'free_pass',
    'discount_offer',
    'in_person_visit',
    'manual',
  ]),
  notes: z.string().max(2000).optional().nullable(),
})

const CloseInterventionInputSchema = z.object({
  interventionId: z.string().uuid(),
  outcome: z.enum(['success', 'partial', 'failed', 'member_canceled_anyway']),
  outcomeNotes: z.string().max(2000).optional().nullable(),
})

const FeedbackCancellationInputSchema = z.object({
  memberId: z.string().uuid(),
  reason: z.enum([
    'financial',
    'location',
    'health',
    'competitor',
    'satisfaction',
    'schedule',
    'other',
  ]),
  reasonDetail: z.string().max(2000).optional().nullable(),
})

// ─── Helpers (loaders) ───────────────────────────────────────────────────

async function loadMemberRawData(
  memberId: string,
  tenantId: string,
): Promise<{
  checkInDates: string[]
  invoices: Array<{
    status: 'paid' | 'overdue' | 'pending' | 'cancelled' | 'refunded'
    amountCents: number
    dueDate: string
    paidAt?: string | null
  }>
  contractStartedAt: string
  achievementsEarned90d: number
  goalsActiveCount: number
}> {
  const since = new Date()
  since.setDate(since.getDate() - 90)

  // Check-ins: usa accessEvents do Sprint 08 quando disponível;
  // appointments serve de fallback (member confirmado em agendamento conta como interação)
  const checkInsRaw = await db
    .select({ at: accessEvents.at })
    .from(accessEvents)
    .where(
      and(
        eq(accessEvents.tenantId, tenantId),
        eq(accessEvents.memberId, memberId),
        gte(accessEvents.at, since),
      ),
    )

  const appointmentsRaw = await db
    .select({ at: appointments.startsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.memberId, memberId),
        gte(appointments.startsAt, since),
      ),
    )

  const checkInDates = [
    ...checkInsRaw.map((r) => r.at.toISOString()),
    ...appointmentsRaw.map((r) => r.at.toISOString()),
  ]

  // Invoices
  const invoiceRows = await db
    .select({
      status: invoices.status,
      amountCents: invoices.amountCents,
      dueAt: invoices.dueAt,
      paidAt: invoices.paidAt,
    })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.memberId, memberId)))
    .orderBy(desc(invoices.dueAt))
    .limit(50)

  // Contract (start mais antigo do member)
  const [contract] = await db
    .select({ startedAt: contracts.startedAt })
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.memberId, memberId)))
    .orderBy(asc(contracts.startedAt))
    .limit(1)
  const contractStartedAt =
    contract?.startedAt?.toISOString() ?? new Date().toISOString()

  // Achievements últimos 90d
  const [achievCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(memberAchievements)
    .where(
      and(
        eq(memberAchievements.tenantId, tenantId),
        eq(memberAchievements.memberId, memberId),
        gte(memberAchievements.earnedAt, since),
      ),
    )

  // Goals ativos
  const [goalsActive] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(goals)
    .where(
      and(
        eq(goals.tenantId, tenantId),
        eq(goals.memberId, memberId),
        eq(goals.status, 'active'),
      ),
    )

  return {
    checkInDates,
    invoices: invoiceRows.map((i) => ({
      status: i.status,
      amountCents: i.amountCents,
      dueDate: i.dueAt.toISOString().slice(0, 10),
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
    })),
    contractStartedAt,
    achievementsEarned90d: Number(achievCount?.count ?? 0),
    goalsActiveCount: Number(goalsActive?.count ?? 0),
  }
}

// ─── scorePredict ────────────────────────────────────────────────────────

export const scorePredict = wrapServerAction(
  { module: 'retencao', action: 'churn.score_predict', resourceType: 'churn_predictions' },
  async (input: z.infer<typeof ScorePredictInputSchema>, { session, setAuditResource }) => {
    const parsed = ScorePredictInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida member existe + pertence ao tenant
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (!member)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })

    // Computa features
    const raw = await loadMemberRawData(parsed.memberId, tenantId)
    const features = computeFeatures(raw)
    const snapshotHash = hashFeatures(features)

    // Cache check: já existe snapshot com mesmo hash + predição válida?
    if (!parsed.force) {
      const [existing] = await db
        .select({
          predictionId: churnPredictions.id,
          predictedAt: churnPredictions.predictedAt,
          validUntil: churnPredictions.validUntil,
        })
        .from(churnPredictions)
        .innerJoin(
          churnFeaturesSnapshot,
          eq(churnFeaturesSnapshot.id, churnPredictions.snapshotId),
        )
        .where(
          and(
            eq(churnPredictions.tenantId, tenantId),
            eq(churnPredictions.memberId, parsed.memberId),
            eq(churnFeaturesSnapshot.snapshotHash, snapshotHash),
            gte(churnPredictions.validUntil, new Date()),
          ),
        )
        .orderBy(desc(churnPredictions.predictedAt))
        .limit(1)
      if (existing) {
        return { predictionId: existing.predictionId, cached: true }
      }
    }

    // Persiste novo snapshot
    const startedAt = Date.now()
    const [snapshot] = await db
      .insert(churnFeaturesSnapshot)
      .values({
        tenantId,
        memberId: parsed.memberId,
        features: features as unknown as Record<string, unknown>,
        snapshotHash,
      })
      .returning({ id: churnFeaturesSnapshot.id })
    if (!snapshot)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao gravar snapshot',
        request_id: '',
      })

    // Prediz (Fase 1: LLM se disponível; senão heurística)
    // MVP: sem LLM real ainda — chama heurística. Sprint 19+ liga llmClassifyFn
    // usando @repo/ai resolveModelForTask + classifier.
    const prediction: ChurnPrediction = await predictChurn(features)
    const latencyMs = Date.now() - startedAt

    // Persist prediction
    const validUntil = new Date()
    validUntil.setHours(validUntil.getHours() + 24)
    const modelVersion =
      prediction.source === 'llm'
        ? 'gemini-2.5-flash@2026-05'
        : 'heuristic-v1@2026-05'

    const [pred] = await db
      .insert(churnPredictions)
      .values({
        tenantId,
        memberId: parsed.memberId,
        snapshotId: snapshot.id,
        modelVersion,
        prob30d: prediction.prob30d.toFixed(3),
        prob60d: prediction.prob60d.toFixed(3),
        prob90d: prediction.prob90d.toFixed(3),
        riskBand: prediction.riskBand,
        topFactors: prediction.topFactors,
        source: prediction.source,
        latencyMs,
        validUntil,
      })
      .returning({ id: churnPredictions.id })

    setAuditResource(pred!.id, {
      memberId: parsed.memberId,
      riskBand: prediction.riskBand,
      prob30d: prediction.prob30d,
      source: prediction.source,
    })
    return {
      predictionId: pred!.id,
      cached: false,
      prediction: {
        ...prediction,
        snapshotHash,
        modelVersion,
        latencyMs,
      },
    }
  },
)

// ─── listAtRiskMembers ───────────────────────────────────────────────────

export const listAtRiskMembers = wrapServerAction(
  { module: 'retencao', action: 'churn.list_at_risk' },
  async (input: z.infer<typeof ListAtRiskInputSchema> | undefined, { session }) => {
    const parsed = ListAtRiskInputSchema.parse(input ?? {})
    const tenantId = session.logifit.tenantId

    // Subquery: predição mais recente por member
    const subquery = sql`
      SELECT DISTINCT ON (member_id)
        id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d,
        risk_band, top_factors, source, predicted_at
      FROM churn_predictions
      WHERE tenant_id = ${tenantId}
      ORDER BY member_id, predicted_at DESC
    `

    const result = await db.execute(sql`
      SELECT
        m.id AS member_id,
        p.name AS member_name,
        latest.id AS prediction_id,
        latest.prob_30d,
        latest.prob_60d,
        latest.prob_90d,
        latest.risk_band,
        latest.top_factors,
        latest.predicted_at,
        latest.source
      FROM members m
      INNER JOIN persons p ON p.id = m.person_id
      INNER JOIN (${subquery}) latest ON latest.member_id = m.id
      WHERE m.tenant_id = ${tenantId} AND m.archived_at IS NULL
        ${parsed.band !== 'all' ? sql`AND latest.risk_band = ${parsed.band}` : sql``}
      ORDER BY latest.prob_30d DESC
      LIMIT ${parsed.limit}
    `)
    return { members: result.rows as unknown as Array<Record<string, unknown>> }
  },
)

// ─── assignIntervention ──────────────────────────────────────────────────

export const assignIntervention = wrapServerAction(
  { module: 'retencao', action: 'churn.assign_intervention', resourceType: 'churn_interventions' },
  async (input: z.infer<typeof AssignInterventionInputSchema>, { session, setAuditResource }) => {
    const parsed = AssignInterventionInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida predição existe no tenant + pega member_id
    const [pred] = await db
      .select({ id: churnPredictions.id, memberId: churnPredictions.memberId })
      .from(churnPredictions)
      .where(
        and(
          eq(churnPredictions.id, parsed.predictionId),
          eq(churnPredictions.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!pred)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Predição não encontrada',
        request_id: '',
      })

    const [row] = await db
      .insert(churnInterventions)
      .values({
        tenantId,
        memberId: pred.memberId,
        predictionId: pred.id,
        assignedToUserId: parsed.assignedToUserId,
        assignedByUserId: session.user.id,
        action: parsed.action,
        notes: parsed.notes ?? null,
      })
      .returning({ id: churnInterventions.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar intervenção',
        request_id: '',
      })
    setAuditResource(row.id, { memberId: pred.memberId, action: parsed.action })
    return { id: row.id }
  },
)

// ─── closeIntervention ──────────────────────────────────────────────────

export const closeIntervention = wrapServerAction(
  { module: 'retencao', action: 'churn.close_intervention', resourceType: 'churn_interventions' },
  async (input: z.infer<typeof CloseInterventionInputSchema>, { session, setAuditResource }) => {
    const parsed = CloseInterventionInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(churnInterventions)
      .set({
        closedAt: new Date(),
        closedByUserId: session.user.id,
        outcome: parsed.outcome,
        outcomeNotes: parsed.outcomeNotes ?? null,
      })
      .where(
        and(
          eq(churnInterventions.id, parsed.interventionId),
          eq(churnInterventions.tenantId, tenantId),
        ),
      )
      .returning({ id: churnInterventions.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Intervenção não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, { outcome: parsed.outcome })
    return { id: row.id }
  },
)

// ─── feedbackCancellation ────────────────────────────────────────────────

export const feedbackCancellation = wrapServerAction(
  { module: 'retencao', action: 'churn.feedback_cancellation', resourceType: 'churn_events' },
  async (input: z.infer<typeof FeedbackCancellationInputSchema>, { session, setAuditResource }) => {
    const parsed = FeedbackCancellationInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Busca última predição pra preencher prob_at_churn + was_predicted
    const [lastPred] = await db
      .select({ prob30d: churnPredictions.prob30d })
      .from(churnPredictions)
      .where(
        and(
          eq(churnPredictions.tenantId, tenantId),
          eq(churnPredictions.memberId, parsed.memberId),
        ),
      )
      .orderBy(desc(churnPredictions.predictedAt))
      .limit(1)

    // Intervenção aberta mais recente
    const [lastIntervention] = await db
      .select({ id: churnInterventions.id })
      .from(churnInterventions)
      .where(
        and(
          eq(churnInterventions.tenantId, tenantId),
          eq(churnInterventions.memberId, parsed.memberId),
        ),
      )
      .orderBy(desc(churnInterventions.assignedAt))
      .limit(1)

    const probAtChurn = lastPred ? Number(lastPred.prob30d) : null
    const wasPredicted = probAtChurn != null ? probAtChurn >= 0.6 : null

    try {
      const [row] = await db
        .insert(churnEvents)
        .values({
          tenantId,
          memberId: parsed.memberId,
          reason: parsed.reason,
          reasonDetail: parsed.reasonDetail ?? null,
          probAtChurn: probAtChurn != null ? probAtChurn.toFixed(3) : null,
          wasPredicted,
          interventionId: lastIntervention?.id ?? null,
          recordedByUserId: session.user.id,
        })
        .returning({ id: churnEvents.id })
      setAuditResource(row!.id, { memberId: parsed.memberId, wasPredicted })
      return { id: row!.id, wasPredicted }
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ??
        (err as { cause?: { code?: string } }).cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Member já tem evento de cancelamento registrado',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── getModelStats ───────────────────────────────────────────────────────
/**
 * Estatísticas agregadas do modelo: precision/recall a partir de churn_events.
 *
 * - TP: was_predicted=true + reason in (financial/satisfaction/etc) → previu certo
 * - FP: was_predicted=true + member ainda ativo (member não cancelou; sem churn_event) — esse cálculo precisa de janela temporal; MVP só apresenta TP/FN agregado.
 *
 * MVP retorna apenas: total predicoes, total cancellations, % was_predicted, banda atual.
 */
export const getModelStats = wrapServerAction(
  { module: 'retencao', action: 'churn.model_stats' },
  async (_input: undefined, { session }) => {
    const tenantId = session.logifit.tenantId

    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(DISTINCT member_id) FROM churn_predictions WHERE tenant_id = ${tenantId})::int AS members_scored,
        (SELECT COUNT(*) FROM churn_events WHERE tenant_id = ${tenantId})::int AS total_cancellations,
        (SELECT COUNT(*) FROM churn_events WHERE tenant_id = ${tenantId} AND was_predicted = true)::int AS predicted_cancellations,
        (SELECT COUNT(*) FROM churn_predictions WHERE tenant_id = ${tenantId} AND risk_band = 'high')::int AS high_risk_now,
        (SELECT COUNT(*) FROM churn_predictions WHERE tenant_id = ${tenantId} AND risk_band = 'medium')::int AS medium_risk_now,
        (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND closed_at IS NULL)::int AS open_interventions,
        (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND outcome = 'success')::int AS successful_interventions,
        (SELECT COUNT(*) FROM churn_interventions WHERE tenant_id = ${tenantId} AND closed_at IS NOT NULL)::int AS closed_interventions
    `)
    const row = (result.rows[0] ?? {}) as Record<string, number | null>
    const totalCancellations = Number(row.total_cancellations ?? 0)
    const predicted = Number(row.predicted_cancellations ?? 0)
    const recall = totalCancellations === 0 ? null : predicted / totalCancellations
    const closed = Number(row.closed_interventions ?? 0)
    const successful = Number(row.successful_interventions ?? 0)
    const successRate = closed === 0 ? null : successful / closed
    void heuristicPredict
    return {
      membersScored: Number(row.members_scored ?? 0),
      totalCancellations,
      predictedCancellations: predicted,
      recallEstimate: recall != null ? Number(recall.toFixed(3)) : null,
      highRiskNow: Number(row.high_risk_now ?? 0),
      mediumRiskNow: Number(row.medium_risk_now ?? 0),
      openInterventions: Number(row.open_interventions ?? 0),
      successfulInterventions: successful,
      closedInterventions: closed,
      interventionSuccessRate: successRate != null ? Number(successRate.toFixed(3)) : null,
    }
  },
)

// wrap-exempt: helper de leitura pra Server Component (read-only, recebe tenantId via parâmetro — não Server Action de browser)
export async function loadFeaturesForUI(
  memberId: string,
  tenantId: string,
): Promise<ChurnFeatures> {
  const raw = await loadMemberRawData(memberId, tenantId)
  return computeFeatures(raw)
}

