/**
 * Nutri-Agent IA — Sprint 34 Faixa A (ADRs 0043 + 0044 esperados).
 *
 * 3 tabelas:
 *   - `nutri_agent_runs` — execução do agente (1 por trigger). Audit:
 *     quem disparou, member alvo, status, custos, modelo usado.
 *   - `nutri_agent_suggestions` — propostas geradas pela run; cada uma com
 *     kind (plan_adjustment/alert/risk_pattern/pre_consult_summary) + status
 *     (pending/accepted/rejected) + revisão profissional obrigatória (ADR 0044).
 *   - `nutri_agent_metrics_snapshot` — snapshot dos dados que o agent leu
 *     no momento da execução. Audit + reprodutibilidade + LGPD (provar quais
 *     dados foram processados).
 *
 * **Regra 28 + ADR 0044**: NUNCA escreve direto em meal_plans. Toda sugestão
 *   é proposta; profissional revisa + aceita + dispara updateMealPlan (Sprint 29).
 *
 * **Regra 13/28**: gate funcional — `ai_committees.status='active'` obrigatório
 *   pra ativar o agent no tenant (CFM 2.454/2026). Server Action verifica.
 *
 * **ANVISA RDC 657/2022**: agent é SaMD Classe II — exige notificação ANVISA
 *   antes do feature flag ir a prod (ADR 0053).
 *
 * @volume_estimate_yearly: 720000
 *   (1k tenants × 1k members × 1 run/semana × 52 ≈ 52M no pior; MVP estima 720k)
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
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { members } from './members'
import { mealPlans } from './nutri'

// ─── Enums ───────────────────────────────────────────────────────────────

export const nutriAgentRunStatusEnum = pgEnum('nutri_agent_run_status', [
  'queued', // enfileirada
  'collecting', // coletando dados cross-module
  'analyzing', // processando + IA
  'completed', // sugestões geradas
  'failed', // erro técnico
  'blocked', // gate (consent/comitê/SaMD) bloqueou
])

export const nutriAgentRunTriggerEnum = pgEnum('nutri_agent_run_trigger', [
  'manual_professional', // nutri clicou "Re-analisar"
  'pre_consult_auto', // 24h antes da consulta (cron)
  'weekly_adherence', // resumo semanal de aderência
  'risk_event_triggered', // padrão de risco detectado em dados upstream
])

export const nutriAgentSuggestionKindEnum = pgEnum('nutri_agent_suggestion_kind', [
  'plan_adjustment', // sugestão de ajuste no meal_plan ativo
  'alert', // alerta operacional (aderência baixa, déficit extremo)
  'risk_pattern', // padrão de risco detectado (cortisol+sono+déficit)
  'pre_consult_summary', // resumo "estado nutricional" pré-consulta
  'follow_up_exam', // exame complementar sugerido
])

export const nutriAgentSuggestionStatusEnum = pgEnum('nutri_agent_suggestion_status', [
  'pending', // aguarda revisão profissional (default)
  'accepted', // profissional aceitou (e aplicou via SA Sprint 29 quando aplicável)
  'rejected', // profissional rejeitou
  'expired', // não revisado em 14d (cron)
])

export const nutriAgentSuggestionSeverityEnum = pgEnum('nutri_agent_suggestion_severity', [
  'info',
  'attention',
  'critical',
])

// ─── nutri_agent_runs ───────────────────────────────────────────────────

export const nutriAgentRuns = pgTable(
  'nutri_agent_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** Quem disparou (manual) ou null (cron) */
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
    trigger: nutriAgentRunTriggerEnum('trigger').notNull(),
    status: nutriAgentRunStatusEnum('status').notNull().default('queued'),
    /** Modelo IA usado (resolveModelForTask retornou X) */
    modelUsed: text('model_used'),
    /** Custo agregado em centavos */
    costCents: integer('cost_cents'),
    /** Erro técnico ou motivo bloqueio (gate consent/comitê/SaMD) */
    failureReason: text('failure_reason'),
    /** Resumo da run (suggestions count, patterns count, riscos detectados) */
    summary: jsonb('summary'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('nutri_agent_runs_tenant_member_idx').on(t.tenantId, t.memberId, t.queuedAt.desc()),
    /** Lookup quente: pending/running */
    index('nutri_agent_runs_active_idx')
      .on(t.tenantId, t.queuedAt)
      .where(sql`status IN ('queued', 'collecting', 'analyzing')`),
    check(
      'nutri_agent_runs_completed_consistency',
      sql`(status NOT IN ('completed', 'failed', 'blocked') OR completed_at IS NOT NULL)`,
    ),
  ],
)

// ─── nutri_agent_suggestions ────────────────────────────────────────────

export const nutriAgentSuggestions = pgTable(
  'nutri_agent_suggestions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => nutriAgentRuns.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: nutriAgentSuggestionKindEnum('kind').notNull(),
    severity: nutriAgentSuggestionSeverityEnum('severity').notNull().default('info'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** Evidência: lista de campos consultados ({source: 'meal_log', metric, value, at}) */
    evidence: jsonb('evidence'),
    /** Confidence 0-1 do agent */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    /** Para kind='plan_adjustment': diff proposto sobre meal_plan ativo */
    proposedChanges: jsonb('proposed_changes'),
    /** Vínculo opcional com meal_plan alvo (kind='plan_adjustment') */
    targetMealPlanId: uuid('target_meal_plan_id').references(() => mealPlans.id, {
      onDelete: 'set null',
    }),
    /** Bloqueio do classifier anti-diagnóstico (reusa Sprint 33) */
    blockedByClassifier: boolean('blocked_by_classifier').notNull().default(false),
    classifierBlockedTerms: jsonb('classifier_blocked_terms'),
    status: nutriAgentSuggestionStatusEnum('status').notNull().default('pending'),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    /** Se kind='plan_adjustment' aceito + aplicado, FK pro novo meal_plan version */
    appliedMealPlanId: uuid('applied_meal_plan_id').references(() => mealPlans.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Fila do profissional: pending por tenant/member */
    index('nutri_agent_suggestions_pending_idx')
      .on(t.tenantId, t.createdAt.desc())
      .where(sql`status = 'pending'`),
    index('nutri_agent_suggestions_member_idx').on(t.memberId, t.createdAt.desc()),
    index('nutri_agent_suggestions_run_idx').on(t.runId),
    /** Critical / attention recentes */
    index('nutri_agent_suggestions_severity_idx')
      .on(t.tenantId, t.severity, t.createdAt.desc())
      .where(sql`status = 'pending'`),
    check(
      'nutri_agent_suggestions_confidence_range',
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    check(
      'nutri_agent_suggestions_reviewed_consistency',
      sql`(status NOT IN ('accepted', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))`,
    ),
  ],
)

// ─── nutri_agent_metrics_snapshot ────────────────────────────────────────
/**
 * Snapshot dos dados consultados na run. Audit forense + reprodutibilidade
 * (rodar de novo a análise dá o mesmo resultado se input idêntico).
 *
 * `data jsonb` formato canônico:
 *   {
 *     meal_plan: { id, name, target_kcal, ... } | null,
 *     last_diary_summaries: [{ date, total_kcal, adherence_pct }],
 *     anthropometric_trend: [{ date, weight_kg, ... }],
 *     workout_load: { weekly_kcal_est, sessions_count },
 *     fisio_active_cids: [...],
 *     lab_results_recent: [...],
 *     device_summary: { resting_hr_avg, sleep_avg, ... },
 *     consents_used: [...]
 *   }
 */
export const nutriAgentMetricsSnapshot = pgTable(
  'nutri_agent_metrics_snapshot',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => nutriAgentRuns.id, { onDelete: 'cascade' }),
    /** Dados snapshot — formato documentado acima */
    data: jsonb('data').notNull(),
    /** Hash SHA-256 do data jsonb pra detecção de reprodutibilidade */
    dataHash: text('data_hash').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('nutri_agent_metrics_run_idx').on(t.runId),
    index('nutri_agent_metrics_hash_idx').on(t.dataHash),
  ],
)

export type NutriAgentRunRow = typeof nutriAgentRuns.$inferSelect
export type NutriAgentSuggestionRow = typeof nutriAgentSuggestions.$inferSelect
export type NutriAgentMetricsSnapshotRow = typeof nutriAgentMetricsSnapshot.$inferSelect
