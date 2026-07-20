import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const cnpjCache = pgTable('cnpj_cache', {
  // 14 dígitos normalizados (sem formatação) — PK natural
  cnpj: text('cnpj').primaryKey(),

  // Payload completo do provider — formato canônico LogiFit (ADR 0048 §formato)
  data: jsonb('data').notNull(),

  providerUsed: text('provider_used').notNull(), // 'brasilapi' | 'receitaws' | 'cnpja'

  // Situação cadastral — usado pelo job semanal de revalidação
  // valores canônicos: 'ativa' | 'suspensa' | 'baixada' | 'inapta' | 'nula' | 'desconhecida'
  situacao: text('situacao').notNull(),

  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export type CnpjCacheRow = typeof cnpjCache.$inferSelect
export type CnpjCacheInsert = typeof cnpjCache.$inferInsert

export const tenantCnpjSettings = pgTable('tenant_cnpj_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  providerPrimary: text('provider_primary').notNull().default('brasilapi'),
  providerFallback: text('provider_fallback'),
  // Cifrado (KEK por tenant) — Sprint 02+ implementa criptografia at-rest;
  // por enquanto fica em jsonb claro (apenas tenant_owner acessa via RLS).
  credentialsEncrypted: jsonb('credentials_encrypted'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TenantCnpjSettingsRow = typeof tenantCnpjSettings.$inferSelect
export type TenantCnpjSettingsInsert = typeof tenantCnpjSettings.$inferInsert
