/**
 * `consents` — Sprint 01b (regra 29 + ADR 0054).
 *
 * LGPD art. 8: consent **granular por finalidade** + livre + informado +
 * inequívoco. Aqui modelamos cada **propósito declarado** separadamente.
 *
 * Member/paciente pode dar/revogar consent independente por finalidade:
 *   - `whatsapp_marketing` — recebe promoção/regua via WhatsApp
 *   - `email_marketing` — recebe campanha via email
 *   - `cross_company_data_share` — dado pode cruzar matriz↔filial (regra 25
 *     limitada a financeiro em franchise)
 *   - `cross_tenant_passport` — passaporte cross-tenant ativado (Sprint 01b
 *     Faixa B — regra 42)
 *   - `ai_processing_clinical` — IA pode processar dado clínico (Sprint 06+)
 *   - `device_telemetry_share` — wearable data pode ir pro nutri (Sprint 32+)
 *   - `image_capture` — foto/avatar (LGPD art. 11 — biometria)
 *   - `lab_result_ai_interpretation` — IA pode interpretar exame (Sprint 33)
 *
 * **Schema canon: 1 row por (person_id, purpose_key, scope)**. Revogação =
 * insert nova row com `revoked_at` setado (NÃO faz UPDATE — preserva trilha).
 * Última row por (person_id, purpose_key) determina estado atual.
 *
 * `ripd_document_id` (futuro Sprint 02+) liga ao RIPD vigente — se RIPD muda,
 * consent vira `requires_renewal=true` e member precisa re-opt-in.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { persons } from './persons'

// Catálogo de propósitos canônicos. Sprint 02+ amplia via migration.
export const consentPurposeEnum = pgEnum('consent_purpose', [
  'whatsapp_marketing',
  'email_marketing',
  'cross_company_data_share',
  'cross_tenant_passport',
  'ai_processing_clinical',
  'device_telemetry_share',
  'image_capture',
  'lab_result_ai_interpretation',
  'whatsapp_transactional', // confirmação agendamento, cobrança
  'profile_data_export', // portabilidade LGPD
])

// LGPD art. 7 + 11
export const consentLegalBasisEnum = pgEnum('consent_legal_basis', [
  'consent', // art. 7 I — consentimento (revogável)
  'contract', // art. 7 V — execução de contrato
  'legal_obligation', // art. 7 II — obrigação legal (CFM 2.299, prontuário 20y)
  'vital_interests', // art. 7 IV — proteção da vida (emergência)
  'health_protection', // art. 11 II "a" — tutela da saúde
  'public_interest', // art. 7 III — políticas públicas
  'legitimate_interest', // art. 7 IX — interesse legítimo
])

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),

    purpose: consentPurposeEnum('purpose').notNull(),
    legalBasis: consentLegalBasisEnum('legal_basis').notNull().default('consent'),

    // Estado atual: granted=true + revoked_at=null → ativo
    granted: boolean('granted').notNull().default(true),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    // Versão do RIPD documentada no momento do consent. Sprint 02+ liga.
    ripdVersion: text('ripd_version'),

    // IP + user agent do registro (audit defesa profundidade)
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    // Scope opcional — útil pra cross_company / cross_tenant
    scopeTenantId: uuid('scope_tenant_id'), // pra cross_tenant
    scopeCompanyId: uuid('scope_company_id'), // pra cross_company

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Histórico cronológico — última row por (person, purpose, scope) determina estado
    index('consents_person_purpose_idx').on(t.personId, t.purpose, t.createdAt.desc()),
    index('consents_tenant_idx').on(t.tenantId),
    // Lookup pra "consents ativos por person"
    uniqueIndex('consents_active_uq')
      .on(t.personId, t.purpose, t.scopeTenantId, t.scopeCompanyId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
)

export type ConsentRow = typeof consents.$inferSelect
export type ConsentInsert = typeof consents.$inferInsert
