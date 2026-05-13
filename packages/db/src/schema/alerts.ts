/**
 * Cross-alert dispatcher — Sprint 07 (ADR 0070 esperado).
 *
 * Tabela esqueleto pra Fase 2 popular com subscribers reais (regra de
 * disparo de alerta cross-module). MVP: tabela vazia + função
 * `dispatchAlert(event)` em Server Action que faz lookup mas não encontra
 * subscribers — preparação pra Sprint 13+ régua de comunicação.
 *
 * Exemplos futuros de subscriber:
 *   - event `appointment.no_show` × target_role `recepcao` → notifica recepção
 *   - event `contract.overdue` × target_role `gerente` → notifica gerente
 *   - event `member.inactive_30d` × target_role `personal` → notifica PT
 *
 * **Vazio no MVP** — preparação arquitetural conforme ADR 0070.
 */
import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const alertSubscribers = pgTable(
  'alert_subscribers',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    eventKind: text('event_kind').notNull(), // ex: 'appointment.no_show', 'contract.overdue'
    targetRole: text('target_role').notNull(), // ex: 'recepcao', 'gerente', 'personal'
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('alert_subscribers_tenant_event_idx')
      .on(t.tenantId, t.eventKind)
      .where(sql`active = true`),
  ],
)
