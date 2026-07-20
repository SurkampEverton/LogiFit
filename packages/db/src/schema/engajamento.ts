/**
 * Engajamento (conquistas + brindes + metas) — Sprint 09 Faixa A (ADR 0021 esperado).
 *
 * 6 tabelas:
 *   - `achievements` (catálogo de conquistas + rule jsonb declarativa)
 *   - `member_achievements` (instâncias atribuídas — PK composta evita re-disparo)
 *   - `rewards_catalog` (catálogo de brindes físicos/digitais/serviços)
 *   - `reward_grants` (brindes concedidos com state machine workflow)
 *   - `goals` (metas do member com progresso automático)
 *   - `goal_measurements` (audit de medições)
 *
 * **DSL de regra de conquista** (`achievements.rule jsonb`):
 *   ```json
 *   { "kind": "checkin_count", "params": { "target": 50, "within_days": 30 } }
 *   { "kind": "payment_streak", "params": { "months": 12 } }
 *   { "kind": "goal_reached", "params": { "goal_kind": "weight_loss" } }
 *   ```
 *   Sprint 09+ Faixa B: avaliador (`packages/ai/engajamento/evaluator.ts`)
 *   recebe `(rule, member_ctx)` retorna `{matched, progress}`. JSON Schema Zod
 *   garante validação no INSERT.
 *
 * **Idempotência**: `member_achievements` PK composta `(member_id, achievement_id)`
 * impede re-disparo (regra ganha uma vez só por member).
 *
 * @volume_estimate_yearly: 500000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
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

export const rewardKindEnum = pgEnum('reward_kind', [
  'physical', // brinde físico (camiseta, garrafa) — stock_qty obrigatório
  'digital_credit', // crédito em cashback_ledger ou similar
  'service_credit', // crédito em appointment_credits (PT, consulta, etc)
])

export const rewardGrantSourceEnum = pgEnum('reward_grant_source', [
  'achievement', // conquista desbloqueada
  'referral', // recompensa de referral
  'manual', // grant operador manual
  'promotion', // disparo de promoção
])

export const rewardGrantStatusEnum = pgEnum('reward_grant_status', [
  'pending_redeem', // member precisa retirar/aceitar
  'redeemed', // member confirmou (físico)
  'shipped', // físico enviado
  'delivered', // físico entregue
  'cancelled', // grant cancelado (ex: estoque acabou)
])

export const goalKindEnum = pgEnum('goal_kind', [
  'weight_loss',
  'weight_gain',
  'frequency', // ex: 3 check-ins/semana
  'strength_pr', // personal record em exercício
  'body_composition', // % gordura, massa magra
  'custom',
])

export const goalStatusEnum = pgEnum('goal_status', ['active', 'reached', 'missed', 'abandoned'])

export const goalMeasurementSourceEnum = pgEnum('goal_measurement_source', [
  'antropometria', // medição em avaliação física (Sprint 12)
  'checkin_count', // calculado de access_events (Sprint 08)
  'workout_log', // log de treino (Sprint 11)
  'self_report', // member reportou via portal
  'manual', // operador registrou
])

// ─── achievements (catálogo) ─────────────────────────────────────────────
export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
    /**
     * Regra declarativa. Sprint 09+ Faixa B valida via Zod no INSERT.
     * MVP kinds canônicos: 'checkin_count', 'payment_streak', 'goal_reached',
     * 'tenure_days', 'referral_count'.
     */
    rule: jsonb('rule').notNull(),
    rewardId: uuid('reward_id'), // FK pra rewards_catalog (set null on delete)
    points: numeric('points', { precision: 10, scale: 0 }).notNull().default('0'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('achievements_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`active = true AND archived_at IS NULL`),
  ],
)

// ─── member_achievements (instâncias) ────────────────────────────────────
/**
 * PK composta `(member_id, achievement_id)` — 1 conquista por member.
 * Re-avaliação da rule NÃO recria a row (idempotente). Para "conquistas
 * repetíveis" (ex: "100 check-ins por mês"), criar 1 achievement nova por
 * período (com `name` distinto).
 */
export const memberAchievements = pgTable(
  'member_achievements',
  {
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    achievementId: uuid('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
    progress: jsonb('progress'), // snapshot da avaliação no momento (ex: {current: 50, target: 50})
  },
  (t) => [
    uniqueIndex('member_achievements_pk').on(t.memberId, t.achievementId),
    index('member_achievements_tenant_earned_idx').on(t.tenantId, t.earnedAt),
  ],
)

// ─── rewards_catalog ─────────────────────────────────────────────────────
export const rewardsCatalog = pgTable(
  'rewards_catalog',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: rewardKindEnum('kind').notNull(),
    /**
     * Referência ao valor concreto:
     *   - physical: `{ "sku": "camiseta-m", "shipping_required": true }`
     *   - digital_credit: `{ "amount_cents": 5000 }` (cashback futuro)
     *   - service_credit: `{ "service_type": "personal_training", "quantity": 1, "validity_days": 60 }`
     */
    valueRef: jsonb('value_ref').notNull(),
    stockQty: numeric('stock_qty', { precision: 10, scale: 0 }),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rewards_catalog_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`active = true AND archived_at IS NULL`),
    check('rewards_catalog_stock_non_negative', sql`${t.stockQty} IS NULL OR ${t.stockQty} >= 0`),
  ],
)

// ─── reward_grants (instâncias com workflow) ─────────────────────────────
/**
 * State machine pra brinde físico:
 *   pending_redeem → redeemed → shipped → delivered
 *                              ↘ cancelled
 * Brinde digital_credit/service_credit: cria appointment_credit/cashback
 * direto + status `redeemed` (não tem shipping).
 */
export const rewardGrants = pgTable(
  'reward_grants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    rewardId: uuid('reward_id')
      .notNull()
      .references(() => rewardsCatalog.id, { onDelete: 'restrict' }),
    source: rewardGrantSourceEnum('source').notNull(),
    sourceRef: uuid('source_ref'), // FK lógica (achievement_id, referral_id, etc)
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    status: rewardGrantStatusEnum('status').notNull().default('pending_redeem'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    notes: text('notes'),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
  },
  (t) => [
    index('reward_grants_tenant_member_idx').on(t.tenantId, t.memberId, t.grantedAt),
    index('reward_grants_status_idx').on(t.tenantId, t.status),
    index('reward_grants_pending_idx')
      .on(t.tenantId)
      .where(sql`status IN ('pending_redeem', 'shipped')`),
  ],
)

// ─── goals (metas do member) ─────────────────────────────────────────────
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: goalKindEnum('kind').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** numeric pra suportar peso (kg.dd), %, contagens */
    targetValue: numeric('target_value', { precision: 12, scale: 2 }).notNull(),
    currentValue: numeric('current_value', { precision: 12, scale: 2 }).notNull().default('0'),
    targetUnit: text('target_unit').notNull(), // 'kg' | 'checkins/sem' | '%' | 'reps'
    targetDate: text('target_date').notNull(), // ISO date string (YYYY-MM-DD)
    status: goalStatusEnum('status').notNull().default('active'),
    reachedAt: timestamp('reached_at', { withTimezone: true }),
    abandonedReason: text('abandoned_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('goals_tenant_member_idx').on(t.tenantId, t.memberId, t.status),
    index('goals_active_idx').on(t.tenantId, t.memberId).where(sql`status = 'active'`),
  ],
)

// ─── goal_measurements (audit) ───────────────────────────────────────────
export const goalMeasurements = pgTable(
  'goal_measurements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    source: goalMeasurementSourceEnum('source').notNull(),
    sourceRef: uuid('source_ref'), // FK lógica (avaliacao_id, etc)
    notes: text('notes'),
    measuredByUserId: uuid('measured_by_user_id').references(() => users.id),
  },
  (t) => [
    index('goal_measurements_goal_at_idx').on(t.goalId, t.measuredAt),
    index('goal_measurements_tenant_idx').on(t.tenantId),
  ],
)
