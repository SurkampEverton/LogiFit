/**
 * Vendas / Funil — Sprint 10 Faixa A (ADR 0022 esperado).
 *
 * 5 tabelas:
 *   - `lead_stages` (configurável por tenant; default 6 estágios)
 *   - `leads` (cadastro + person_id opcional inicialmente + quick_name/phone)
 *   - `lead_events` (audit append-only de movimentações)
 *   - `trial_classes` (link lead ↔ appointment trial)
 *   - `proposals` (orçamentos versionados)
 *
 * **Modelo ADR 0022**: `leads.person_id` FK pra `persons` (Sprint 01a ADR 0047);
 * conversão `lead → member` reusa mesmo `person_id` (zero duplicação de
 * identidade). `leads.converted_to_member_id` preserva histórico funil.
 *
 * **quick_name/quick_phone**: captura mínima quando lead ainda não tem CPF
 * confirmado. Trigger (Sprint 10 Faixa B) valida que `person_id` é obrigatório
 * quando lead avança pra estágio `proposta` ou `matriculado` (kind='won').
 *
 * @volume_estimate_yearly: 100000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { contracts, plans } from './financeiro'
import { companies, units, users } from './identity'
import { members } from './members'
import { persons } from './persons'

// ─── Enums ───────────────────────────────────────────────────────────────

export const leadStageKindEnum = pgEnum('lead_stage_kind', [
  'open', // estágio intermediário (lead em andamento)
  'won', // terminal positivo (matriculado)
  'lost', // terminal negativo (perdido — motivo obrigatório)
])

export const leadSourceEnum = pgEnum('lead_source', [
  'website',
  'instagram',
  'referral', // links com referrals (Sprint 05) via source_ref
  'walk_in',
  'panfleto',
  'gympass',
  'totalpass',
  'outdoor',
  'other',
])

export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
])

export const trialOutcomeEnum = pgEnum('trial_outcome', [
  'booked', // agendado, aguarda comparecer
  'attended', // member compareceu (link com appointment.checked_in)
  'no_show',
  'cancelled',
])

// ─── lead_stages (configurável por tenant) ──────────────────────────────
/**
 * Cada tenant tem sua trilha de estágios. Default 6: novo / contato_feito /
 * aula_experimental / proposta / matriculado / perdido. Editável via UI
 * `/app/vendas/funil/configurar` (Sprint 10 Faixa C).
 *
 * `kind` enum classifica estágio terminal positivo (won) ou negativo (lost).
 * Apenas 1 stage `kind='won'` ativo por tenant (constraint Sprint 10 Faixa B).
 */
export const leadStages = pgTable(
  'lead_stages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    orderIdx: integer('order_idx').notNull(),
    kind: leadStageKindEnum('kind').notNull().default('open'),
    color: text('color'), // hex pra board kanban (var(--ev-primary) fallback)
    requiresPerson: boolean('requires_person').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lead_stages_tenant_slug_uq').on(t.tenantId, t.slug),
    index('lead_stages_tenant_order_idx').on(t.tenantId, t.orderIdx).where(sql`active = true`),
  ],
)

// ─── leads ──────────────────────────────────────────────────────────────
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    /**
     * FK pra persons quando lead já tem identidade confirmada.
     * Null durante captura inicial — preenchido em upgradeLeadToPerson()
     * Server Action ou quando avança pra estágio 'proposta'.
     */
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'set null' }),
    quickName: text('quick_name'), // captura rápida quando person_id é null
    quickPhone: text('quick_phone'),
    quickEmail: text('quick_email'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => leadStages.id, { onDelete: 'restrict' }),
    source: leadSourceEnum('source').notNull().default('other'),
    sourceRef: uuid('source_ref'), // referral_id, gympass_session_id, etc
    interest: text('interest'),
    notes: text('notes'),
    convertedToMemberId: uuid('converted_to_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    lostReason: text('lost_reason'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('leads_tenant_stage_idx').on(t.tenantId, t.stageId),
    index('leads_tenant_assigned_idx').on(t.tenantId, t.assignedToUserId),
    index('leads_active_idx').on(t.tenantId).where(sql`archived_at IS NULL`),
    index('leads_person_idx').on(t.personId),
    check(
      'leads_min_contact_or_person',
      sql`person_id IS NOT NULL OR quick_name IS NOT NULL OR quick_phone IS NOT NULL`,
    ),
  ],
)

// ─── lead_events (audit) ────────────────────────────────────────────────
export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'stage_changed' | 'note_added' | 'trial_booked' | ...
    fromStageId: uuid('from_stage_id').references(() => leadStages.id),
    toStageId: uuid('to_stage_id').references(() => leadStages.id),
    payload: text('payload'), // texto/JSON serializado opcional
    actorUserId: uuid('actor_user_id').references(() => users.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lead_events_lead_at_idx').on(t.leadId, t.at),
    index('lead_events_tenant_kind_idx').on(t.tenantId, t.kind),
  ],
)

// ─── trial_classes (link lead ↔ appointment) ────────────────────────────
export const trialClasses = pgTable(
  'trial_classes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /**
     * FK lógica pra appointments (Sprint 03). Não usamos `references()` pra
     * evitar dependência circular schema entre vendas ↔ agenda.
     */
    appointmentId: uuid('appointment_id').notNull(),
    outcome: trialOutcomeEnum('outcome').notNull().default('booked'),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trial_classes_appointment_uq').on(t.appointmentId),
    index('trial_classes_tenant_lead_idx').on(t.tenantId, t.leadId),
  ],
)

// ─── proposals ──────────────────────────────────────────────────────────
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    bundlePlanId: uuid('bundle_plan_id').references(() => plans.id, { onDelete: 'set null' }),
    priceCents: integer('price_cents').notNull(),
    discountCents: integer('discount_cents').notNull().default(0),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    status: proposalStatusEnum('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    /**
     * Quando proposal `accepted` dispara `convertLeadToMember`, salva
     * `contract_id` do contract criado (Sprint 04). FK lógica.
     */
    convertedContractId: uuid('converted_contract_id').references(() => contracts.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('proposals_tenant_lead_idx').on(t.tenantId, t.leadId),
    index('proposals_tenant_status_idx').on(t.tenantId, t.status),
    index('proposals_active_idx').on(t.tenantId, t.leadId).where(sql`status IN ('draft', 'sent')`),
    check('proposals_price_non_negative', sql`${t.priceCents} >= 0`),
    check('proposals_discount_non_negative', sql`${t.discountCents} >= 0`),
    check('proposals_discount_lt_price', sql`${t.discountCents} < ${t.priceCents}`),
    check(
      'proposals_one_plan_xor_bundle',
      sql`(plan_id IS NOT NULL)::int + (bundle_plan_id IS NOT NULL)::int <= 1`,
    ),
  ],
)
