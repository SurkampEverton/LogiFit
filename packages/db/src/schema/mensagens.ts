/**
 * Mensagens — WhatsApp + Email + Régua declarativa
 *   Sprint 13 Faixa A (ADR 0025 + ADR 0026).
 *
 * 5 tabelas core (MVP outbound):
 *   - `message_providers` (config por tenant: WhatsApp/Email/SMS; credentials encrypted)
 *   - `message_templates` (templates com variáveis + approval flow WhatsApp)
 *   - `reguas` (motor declarativo DSL JSON: trigger + actions + stop_on + guards)
 *   - `regua_executions` (instâncias rodando: per-member, state machine)
 *   - `messages_sent` (audit append-only com provider_message_id + delivery callbacks)
 *
 * **Hub inbound** (ADR 0051): adiado pra Sprint 13b. Schemas
 * `whatsapp_inbound_messages` + `whatsapp_conversations` + `tenant_whatsapp_settings`
 * entram quando POC do provider concluir (regra 9: 1 doing por vez).
 *
 * **DSL régua** (ADR 0026): `reguas.trigger jsonb` + `reguas.actions jsonb`
 * validados por Zod em runtime. Schema canônico:
 * ```json
 * {
 *   "trigger": { "event": "invoice.overdue", "filter": { "days_overdue": [1, 3, 7] } },
 *   "actions": [
 *     { "kind": "send_message", "channel": "whatsapp", "template": "cobranca_d1", "delay": 0 },
 *     { "kind": "send_message", "channel": "whatsapp", "template": "cobranca_d3", "delay_days": 2 },
 *     { "kind": "send_message", "channel": "email", "template": "cobranca_d7", "delay_days": 4 }
 *   ],
 *   "stop_on": ["invoice.paid"],
 *   "guards": { "consent": "marketing_messages", "rate_limit_per_member": 3 }
 * }
 * ```
 *
 * **Provider credentials encrypted** (regra 4 + ADR 0014 envelope crypto):
 * `credentials_encrypted jsonb` armazena AES-256-GCM ciphertext via mesma
 * função `encryptSecret()` usada em asaas_keys. Decrypted só em runtime no
 * `safeFetch()` adapter.
 *
 * **Audit append-only** em `messages_sent` (regra 5): trigger nega UPDATE
 * exceto colunas de callback (`delivered_at`, `read_at`, `failed_at`).
 *
 * @volume_estimate_yearly: 10000000
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const messageChannelEnum = pgEnum('message_channel', ['whatsapp', 'email', 'sms'])

export const messageTemplateApprovalEnum = pgEnum('message_template_approval', [
  'draft', // edição em curso
  'pending', // submetido ao provider, aguardando
  'approved', // pronto pra envio
  'rejected', // provider rejeitou
])

export const reguaExecutionStateEnum = pgEnum('regua_execution_state', [
  'running', // em curso (steps pendentes)
  'completed', // todos steps executados
  'stopped_by_rule', // stop_on disparou (ex: invoice.paid)
  'stopped_by_consent', // consent revogado mid-flight
  'failed', // erro irrecuperável
])

export const messageStatusEnum = pgEnum('message_status', [
  'queued', // criado, aguardando envio
  'sending', // request em curso ao provider
  'sent', // provider aceitou
  'delivered', // callback delivered
  'read', // callback read (WhatsApp)
  'failed', // erro provider ou rate limit
])

// ─── message_providers (config por tenant) ──────────────────────────────
/**
 * 1 row por (tenant, channel). Múltiplos providers do mesmo canal possíveis
 * via `active` flag — útil pra A/B test e fallback (Twilio falha → tenta
 * Z-API). MVP: 1 active por (tenant, channel).
 *
 * `provider text` discriminator: 'twilio'/'gupshup'/'zapi'/'resend'/'ses'/etc.
 *
 * `credentials_encrypted jsonb` cifrado AES-256-GCM via `encryptSecret()`
 * (envelope crypto reusada do Sprint 04 asaas_keys + ADR 0014).
 *
 * `from_identifier text` = telefone "+5511999999999" (WhatsApp) OU email
 * "noreply@logifit.com.br" (email).
 *
 * `sandbox bool`: dev usa sandbox do provider (mensagens não saem pro
 * mundo real).
 */
export const messageProviders = pgTable(
  'message_providers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    channel: messageChannelEnum('channel').notNull(),
    /** 'twilio' / 'gupshup' / 'zapi' / 'resend' / 'ses' */
    provider: text('provider').notNull(),
    credentialsEncrypted: jsonb('credentials_encrypted').notNull(),
    fromIdentifier: text('from_identifier').notNull(),
    sandbox: boolean('sandbox').notNull().default(true),
    active: boolean('active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('message_providers_tenant_channel_idx').on(t.tenantId, t.channel),
    index('message_providers_active_idx').on(t.tenantId, t.channel).where(sql`active = true`),
  ],
)

// ─── message_templates ───────────────────────────────────────────────────
/**
 * `variables text[]` lista as variáveis canônicas esperadas pelo template
 * (`['member.name', 'invoice.amount', 'invoice.due_date']`). Server Action
 * `sendMessage` valida que vars resolvidas batem com a lista.
 *
 * WhatsApp Business API exige template pré-aprovado pelo Meta:
 *   draft → submitForApproval → pending → approved/rejected
 * Email pode pular: `approval_status='approved'` direto.
 *
 * `provider_template_id text nullable`: ID do template no provider após
 * aprovação (Twilio HX..., Gupshup template_name). Usado em runtime pra
 * referenciar template aprovado.
 */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    channel: messageChannelEnum('channel').notNull(),
    slug: text('slug').notNull(), // ex: 'cobranca_d1', 'reengajamento_15d'
    name: text('name').notNull(),
    subject: text('subject'), // email only
    body: text('body').notNull(),
    /** Lista das variáveis esperadas — ex: ['member.name', 'invoice.amount'] */
    variables: text('variables').array().notNull().default(sql`'{}'::text[]`),
    approvalStatus: messageTemplateApprovalEnum('approval_status').notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    providerTemplateId: text('provider_template_id'),
    rejectionReason: text('rejection_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('message_templates_tenant_slug_uq').on(t.tenantId, t.slug),
    index('message_templates_tenant_channel_idx').on(t.tenantId, t.channel),
    index('message_templates_approved_idx')
      .on(t.tenantId, t.channel)
      .where(sql`approval_status = 'approved' AND archived_at IS NULL`),
  ],
)

// ─── reguas (motor DSL declarativo — ADR 0026) ──────────────────────────
/**
 * `trigger jsonb` formato canônico (validado Zod em runtime):
 * ```
 * { "event": "invoice.overdue", "filter": { "days_overdue": [1, 3, 7] } }
 * ```
 *
 * `actions jsonb` array de steps:
 * ```
 * [
 *   { "kind": "send_message", "channel": "whatsapp", "template_slug": "cobranca_d1", "delay_days": 0 },
 *   { "kind": "send_message", "channel": "email", "template_slug": "cobranca_d3", "delay_days": 2 }
 * ]
 * ```
 *
 * `stop_on jsonb` array de eventos que param execução pré-conclusão:
 * `["invoice.paid", "invoice.cancelled"]`
 *
 * `guards jsonb`:
 * ```
 * { "consent": "marketing_messages", "rate_limit_per_member_24h": 3 }
 * ```
 */
export const reguas = pgTable(
  'reguas',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    trigger: jsonb('trigger').notNull(),
    actions: jsonb('actions').notNull(),
    stopOn: jsonb('stop_on'),
    guards: jsonb('guards'),
    active: boolean('active').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    runsCount: integer('runs_count').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reguas_tenant_active_idx')
      .on(t.tenantId)
      .where(sql`active = true AND archived_at IS NULL`),
  ],
)

// ─── regua_executions (instâncias rodando) ──────────────────────────────
/**
 * 1 row por disparo de régua para member. State machine:
 *   running → completed
 *           → stopped_by_rule (stop_on matched)
 *           → stopped_by_consent (consent revogado mid-flight)
 *           → failed
 *
 * `current_step int`: índice no array `reguas.actions[]` da próxima ação
 * pendente. Cron tick lê WHERE state='running' AND next_action_at <= now()
 * e processa.
 *
 * `next_action_at timestamptz`: quando o próximo step deve disparar
 * (started_at + sum(delays anteriores)).
 *
 * `trigger_event_ref uuid`: FK lógica pro evento que disparou
 * (`domain_events.id` quando Sprint 13+ materializar `domain_events`).
 */
export const reguaExecutions = pgTable(
  'regua_executions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    reguaId: uuid('regua_id')
      .notNull()
      .references(() => reguas.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    triggerEventRef: uuid('trigger_event_ref'),
    /** Payload do evento que disparou — usado pra resolver variáveis dos templates */
    triggerPayload: jsonb('trigger_payload'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    state: reguaExecutionStateEnum('state').notNull().default('running'),
    currentStep: integer('current_step').notNull().default(0),
    failureReason: text('failure_reason'),
  },
  (t) => [
    index('regua_executions_tenant_state_idx').on(t.tenantId, t.state),
    index('regua_executions_pending_idx').on(t.nextActionAt).where(sql`state = 'running'`),
    index('regua_executions_member_idx').on(t.memberId),
  ],
)

// ─── messages_sent (audit append-only) ──────────────────────────────────
/**
 * Audit de toda mensagem enviada. Insert em queued; updates apenas em
 * status callbacks (delivered_at, read_at, failed_at) — trigger preserva
 * imutabilidade do conteúdo.
 *
 * `variables_resolved jsonb` snapshot das vars no momento do envio (ex:
 * `{member.name: "João", invoice.amount: "R$ 150,00"}`). Importante pra
 * audit + debugging.
 *
 * `cost_cents int nullable` preenchido por job offline conciliando com
 * fatura do provider (Sprint 13+).
 *
 * Particionamento previsto >10M rows/ano em rede grande (regra 34 + ADR
 * 0072). Particionar por RANGE (sent_at) mensal entra Sprint 14+ quando
 * volume real justificar.
 */
export const messagesSent = pgTable(
  'messages_sent',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    channel: messageChannelEnum('channel').notNull(),
    provider: text('provider').notNull(),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    reguaExecutionId: uuid('regua_execution_id').references(() => reguaExecutions.id, {
      onDelete: 'set null',
    }),
    status: messageStatusEnum('status').notNull().default('queued'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    /** ID retornado pelo provider — usado pra match em webhook callbacks */
    providerMessageId: text('provider_message_id'),
    costCents: integer('cost_cents'),
    variablesResolved: jsonb('variables_resolved'),
    /** Telefone/email destinatário (snapshot — member.phone pode mudar) */
    recipient: text('recipient').notNull(),
    /** Corpo final renderizado (audit) */
    bodyRendered: text('body_rendered'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_sent_tenant_member_idx').on(t.tenantId, t.memberId, t.createdAt),
    index('messages_sent_tenant_status_idx').on(t.tenantId, t.status),
    index('messages_sent_provider_id_idx').on(t.providerMessageId),
    index('messages_sent_regua_idx').on(t.reguaExecutionId),
    check('messages_sent_cost_non_negative', sql`${t.costCents} IS NULL OR ${t.costCents} >= 0`),
  ],
)

// ─── Re-export agg pra type-safe joins futuros ──────────────────────────
export const _messagesSchemaUnused = {
  messageProviders,
  messageTemplates,
  reguas,
  reguaExecutions,
  messagesSent,
  /** Sentinel: garante coerência com aliases usados em joins (regua + member) */
  _ignore: { numeric, sql },
}
