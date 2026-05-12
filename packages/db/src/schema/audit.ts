/**
 * `audit_log` + `system_alerts` + `system_alert_occurrences` — Sprint 01a Faixa F.
 *
 * Implementa:
 *   - **Regra 5**: audit_log append-only (sem UPDATE/DELETE — enforced via policy + trigger)
 *   - **Regra 39**: hash chain — cada row tem `current_hash = sha256(... || previous_hash)`;
 *     quebra detectada por job `verify-audit-integrity` semanal
 *   - **ADR 0071**: system_alerts com fingerprint + ring buffer 20 occurrences
 *
 * **Particionamento por mês** (regra 34 + ADR 0072) **fica adiado pra Sprint 04+** —
 * regra exige `>5M/ano OU >50k/dia`; volume MVP <50k até primeiro member real.
 * Quando ativar: ALTER inviável (Postgres não converte tabela em particionada);
 * teremos que migrar dados via CREATE TABLE ... LIKE + INSERT SELECT (window
 * curta de read-only). Plano em runbook `docs/runbooks/audit-partition.md` (TODO).
 *
 * **`system_audit_anchor`** (WORM S3 Object Lock pra detecção de adulteração
 * mesmo com acesso DB direto) também adiado — depende de setup S3 com Object
 * Lock + chave LogiFit-managed pra assinatura.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ─── audit_log ────────────────────────────────────────────────────────────
// @volume_estimate_yearly: 5M+ (Sprint 04+ ativa partition; ver runbook)
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

    // Quem fez (auth_user.id como text BetterAuth; users.id LogiFit; ou system)
    actorAuthUserId: text('actor_auth_user_id'), // null = system action
    actorUserId: uuid('actor_user_id'), // LogiFit user (mais útil em audit)
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),

    // O que fez — namespace canônico LogiFit: 'person.created', 'invoice.cancelled' etc.
    action: text('action').notNull(),
    resourceType: text('resource_type'), // 'persons' | 'invoices' | ...
    resourceId: text('resource_id'), // pode ser uuid ou string composta

    // Payload sanitizado (NUNCA grava PII bruto — só hash/scope)
    payload: jsonb('payload'),

    // Hash chain (regra 39) — preenchido por trigger BEFORE INSERT
    currentHash: text('current_hash'),
    previousHash: text('previous_hash'),

    // Request correlation (de @repo/errors wrapAction)
    requestId: text('request_id'),

    // Legal basis (LGPD — usado em ações que tocam PII)
    legalBasis: text('legal_basis'),
  },
  (t) => [
    // Indexes canônicos ADR 0072 — particionamento futuro mantém compatibilidade
    index('audit_log_tenant_at_idx').on(t.tenantId, t.at.desc()),
    index('audit_log_tenant_actor_at_idx').on(t.tenantId, t.actorUserId, t.at.desc()),
    index('audit_log_tenant_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  ],
)

// ─── system_alerts ────────────────────────────────────────────────────────
// Alertas críticos de sistema (ADR 0071). Sprint 02+ amplia com role-based
// visibility (`min_role` filter) + trigger que cria `security_incidents`
// quando severity=critical + category in (security, data_leak, compliance).
export const alertSeverityEnum = pgEnum('alert_severity', [
  'info',
  'warning',
  'error',
  'critical',
])

export const alertCategoryEnum = pgEnum('alert_category', [
  'security',
  'data_leak',
  'compliance',
  'fiscal',
  'financeiro',
  'integration',
  'infra',
  'ai',
  'clinical',
])

export const systemAlerts = pgTable(
  'system_alerts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    severity: alertSeverityEnum('severity').notNull(),
    category: alertCategoryEnum('category').notNull(),

    // Fingerprint pra dedup — alertas com mesma origem/causa agrupam em 1 row
    // com ring buffer de 20 occurrences (regra 34 + ADR 0071).
    fingerprint: text('fingerprint').notNull(),

    title: text('title').notNull(),
    description: text('description'),

    // Estado
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    // Quem pode ver — null = tenant_owner+ (default conservador)
    minRole: text('min_role'),

    // Retention (regra 5+34): info 30d, warning 90d, error 365d, critical 1825d
    retentionDays: integer('retention_days').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fingerprint único por tenant — POST com fingerprint existente atualiza occurrenceCount
    uniqueIndex('system_alerts_tenant_fingerprint_uq').on(t.tenantId, t.fingerprint),
    index('system_alerts_tenant_severity_idx').on(t.tenantId, t.severity),
    index('system_alerts_tenant_lastseen_idx').on(t.tenantId, t.lastSeenAt.desc()),
  ],
)

// ─── system_alert_occurrences ─────────────────────────────────────────────
// Ring buffer de 20 últimas ocorrências por alert. ADR 0071 — preserva
// detalhes (request_id, member_id, payload) sem inflar tabela principal.
export const systemAlertOccurrences = pgTable(
  'system_alert_occurrences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => systemAlerts.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    requestId: text('request_id'),
    memberId: uuid('member_id'), // LGPD link — Sprint 02+ pluga
    payload: jsonb('payload'),
  },
  (t) => [
    index('system_alert_occurrences_alert_idx').on(t.alertId, t.occurredAt.desc()),
  ],
)

export type AuditLogRow = typeof auditLog.$inferSelect
export type AuditLogInsert = typeof auditLog.$inferInsert
export type SystemAlertRow = typeof systemAlerts.$inferSelect
export type SystemAlertInsert = typeof systemAlerts.$inferInsert
export type SystemAlertOccurrenceRow = typeof systemAlertOccurrences.$inferSelect
