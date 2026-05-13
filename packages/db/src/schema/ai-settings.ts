/**
 * `tenant_assistant_settings` — Sprint 06 Faixa C/D real (ADR 0075).
 *
 * 1 row por tenant (PK = tenantId). Configurações do assistente IA:
 *   - `assistant_name` — white-label (default 'Copilot')
 *   - `default_persona` — persona inicial quando user abre o FAB
 *   - `enabled_personas` — quais personas o tenant ativou
 *   - `classifier_strictness` — futuro Sprint 06+ pra permitir `professional_clinical`
 *      conversar sobre doses sem bloqueio absoluto (com Comitê IA aprovado)
 *
 * Sem `INSERT` direto: trigger garante 1 row criada quando tenant é criado.
 * MVP: caller faz upsert na Server Action.
 */
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const tenantAssistantSettings = pgTable('tenant_assistant_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  assistantName: text('assistant_name').notNull().default('Copilot'),
  defaultPersona: text('default_persona').notNull().default('admin'),
  enabledPersonas: jsonb('enabled_personas').notNull().default(sql`'["member","admin","recepcao","professional_clinical","professional_coach"]'::jsonb`),
  /** 'strict' (default) | 'permissive' (Sprint 06+ exige Comitê IA cadastrado) */
  classifierStrictness: text('classifier_strictness').notNull().default('strict'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TenantAssistantSettingsRow = typeof tenantAssistantSettings.$inferSelect
