/**
 * Retenção / Churn — Sprint 19 Faixa A (ADR 0027 esperado promover Accepted).
 *
 * 4 tabelas:
 *   - churn_features_snapshot — snapshot de features estruturadas por member
 *   - churn_predictions — output do modelo (prob_30d/60d/90d + top_factors)
 *   - churn_interventions — ação atribuída a operador + outcome
 *   - churn_events — quando member cancela de fato (feedback loop pra retreino Fase 2)
 *
 * **ADR 0027:** Fase 1 (este sprint) — Família A LLM Gemini classifier + cache 24h
 * + Zod schema output + fallback heurístico. Fase 2 (pós-3 meses dados) — Família B
 * sklearn servido em edge function.
 *
 * **Particionamento `churn_features_snapshot`** (regra 34 + ADR 0072):
 *   - 1k tenants × 200 members médios × 30 snapshots/mês = 6M+ linhas/ano
 *   - PARTITION BY RANGE (snapshot_at) trimestral (migration manual)
 *   - Retenção 5a hot + cold após 2a (alinhado a retreino Fase 2)
 *
 * **Permission gating:**
 *   - `retencao.read` — gerente/diretor/recepção podem ver dashboard
 *   - `retencao.intervene` — só gerente+ atribui intervenção
 *
 * @volume_estimate_yearly: 6000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
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
import { members } from './members'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const interventionActionEnum = pgEnum('intervention_action', [
  'phone_call',
  'whatsapp_message',
  'free_pass',
  'discount_offer',
  'in_person_visit',
  'manual',
])

export const interventionOutcomeEnum = pgEnum('intervention_outcome', [
  'success', // member não cancelou em 30d
  'partial', // engagou mas não retomou totalmente
  'failed', // sem efeito
  'member_canceled_anyway', // cancelou mesmo com intervenção
])

export const churnEventReasonEnum = pgEnum('churn_event_reason', [
  'financial', // problemas de pagamento
  'location', // mudança / longe demais
  'health', // contraindicação / lesão
  'competitor', // foi pro concorrente
  'satisfaction', // não gostou do serviço
  'schedule', // mudança de rotina / horários
  'other',
])

export const churnRiskBandEnum = pgEnum('churn_risk_band', [
  'low', // prob_30d < 0.3
  'medium', // 0.3 ≤ prob_30d < 0.6
  'high', // prob_30d ≥ 0.6
])

// ─── churn_features_snapshot ────────────────────────────────────────────
/**
 * Snapshot point-in-time das features de um member. Imutável (append-only).
 * Job daily recomputa e insere novo snapshot; query mais recente via index.
 *
 * `features jsonb` formato:
 * ```json
 * {
 *   "frequencyLast30d": 12,
 *   "frequencyPrev30d": 18,
 *   "frequencyChangePct": -33.3,
 *   "daysSinceLastCheckin": 5,
 *   "overdueInvoicesCount": 1,
 *   "overdueTotalCents": 18900,
 *   "monthsAsMember": 14,
 *   "avgTicketCents": 18900,
 *   "achievementsEarned90d": 2,
 *   "goalsActiveCount": 1,
 *   "lastPlanChangeAt": "2026-03-15",
 *   "planChangedDowngrade": false
 * }
 * ```
 *
 * `snapshot_hash` (sha256 do features jsonb) usa em cache key — evita
 * predizer 2× se features não mudaram.
 */
export const churnFeaturesSnapshot = pgTable(
  'churn_features_snapshot',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
    features: jsonb('features').notNull(),
    /** sha256 hex do features jsonb para cache key */
    snapshotHash: text('snapshot_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('churn_features_tenant_member_idx').on(t.tenantId, t.memberId, t.snapshotAt),
    index('churn_features_snapshot_at_idx').on(t.snapshotAt),
  ],
)

// ─── churn_predictions ──────────────────────────────────────────────────
/**
 * Output do modelo preditivo. Probabilidades em 3 janelas (30/60/90d) +
 * top_factors explainability (sempre presente, vindo do LLM Fase 1 ou do
 * SHAP value no Fase 2).
 *
 * `prob_30d`/`60d`/`90d` em `numeric(4,3)` (0.000 a 1.000).
 *
 * `valid_until` controla TTL — daily job só recomputa quando expirou OU
 * features mudaram (snapshot_hash diferente do último).
 */
export const churnPredictions = pgTable(
  'churn_predictions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => churnFeaturesSnapshot.id, { onDelete: 'cascade' }),
    /** Identificador do modelo: "gemini-2.5-flash@2026-05" ou "sklearn-v1.2@2026-09" */
    modelVersion: text('model_version').notNull(),
    prob30d: numeric('prob_30d', { precision: 4, scale: 3 }).notNull(),
    prob60d: numeric('prob_60d', { precision: 4, scale: 3 }).notNull(),
    prob90d: numeric('prob_90d', { precision: 4, scale: 3 }).notNull(),
    /** Banda derivada (low/medium/high) — facilita query "top em risco" */
    riskBand: churnRiskBandEnum('risk_band').notNull(),
    /** Array de { factor: string, weight: number, narrative: string } */
    topFactors: jsonb('top_factors').notNull(),
    /** Fonte: "llm" Fase 1 ou "ml" Fase 2 ou "heuristic" fallback */
    source: text('source').notNull().default('llm'),
    /** Latência da inferência (ms) — métrica operacional */
    latencyMs: integer('latency_ms'),
    predictedAt: timestamp('predicted_at', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('churn_pred_tenant_band_idx')
      .on(t.tenantId, t.riskBand, t.predictedAt),
    index('churn_pred_member_idx').on(t.memberId, t.predictedAt),
    uniqueIndex('churn_pred_snapshot_uq').on(t.snapshotId),
    check('churn_prob_30d_range', sql`prob_30d >= 0 AND prob_30d <= 1`),
    check('churn_prob_60d_range', sql`prob_60d >= 0 AND prob_60d <= 1`),
    check('churn_prob_90d_range', sql`prob_90d >= 0 AND prob_90d <= 1`),
  ],
)

// ─── churn_interventions ────────────────────────────────────────────────
/**
 * Ação atribuída a operador quando member está em risco alto. Vincula
 * predição → atendente → outcome no fechamento.
 *
 * Outcome `member_canceled_anyway` alimenta `churn_events` (próxima tabela)
 * via trigger ou Server Action — usado pra calcular precision real do modelo.
 */
export const churnInterventions = pgTable(
  'churn_interventions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    predictionId: uuid('prediction_id')
      .notNull()
      .references(() => churnPredictions.id, { onDelete: 'restrict' }),
    assignedToUserId: uuid('assigned_to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: interventionActionEnum('action').notNull(),
    notes: text('notes'),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    outcome: interventionOutcomeEnum('outcome'),
    outcomeNotes: text('outcome_notes'),
  },
  (t) => [
    index('churn_intv_tenant_open_idx')
      .on(t.tenantId, t.assignedAt)
      .where(sql`closed_at IS NULL`),
    index('churn_intv_member_idx').on(t.memberId, t.assignedAt),
    index('churn_intv_assigned_to_idx').on(t.assignedToUserId).where(sql`closed_at IS NULL`),
  ],
)

// ─── churn_events ───────────────────────────────────────────────────────
/**
 * Evento real de cancelamento. Alimenta o conjunto de validação para
 * calcular precision/recall do modelo + retreino Fase 2.
 *
 * `was_predicted bool` = `prob_30d ≥ 0.6` no momento do cancelamento.
 * `intervention_id` referencia última intervenção aberta (se houve).
 */
export const churnEvents = pgTable(
  'churn_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    eventAt: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
    reason: churnEventReasonEnum('reason').notNull(),
    reasonDetail: text('reason_detail'),
    /** Prob_30d no momento do cancelamento (null se não havia predição) */
    probAtChurn: numeric('prob_at_churn', { precision: 4, scale: 3 }),
    /** True se prob_30d ≥ 0.6 no snapshot mais recente antes do cancelamento */
    wasPredicted: boolean('was_predicted'),
    interventionId: uuid('intervention_id').references(() => churnInterventions.id, {
      onDelete: 'set null',
    }),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
  },
  (t) => [
    uniqueIndex('churn_events_member_uq').on(t.memberId),
    index('churn_events_tenant_at_idx').on(t.tenantId, t.eventAt),
    index('churn_events_predicted_idx').on(t.tenantId, t.wasPredicted),
  ],
)
