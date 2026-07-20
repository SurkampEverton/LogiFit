/**
 * `professional_registrations` — Sprint 01b (ADR 0055).
 *
 * Registro de profissional em conselho de classe (CRM, CRN, CREFITO, CREF,
 * CRF, CRP, COREN, CRO). Pré-requisito pra:
 *   - Assinatura ICP-Brasil prontuário médico (Sprint 20 — Lei 13.787/2018 +
 *     CFM 2.299/2021)
 *   - Faturamento TISS guia clínica (Sprint 22)
 *   - Comissões + repasse RPA (Sprint 23)
 *   - Onboarding PT (Sprint 08 — gate facial só profissional CREF ativo)
 *
 * **Constraint global**: `(council_body, council_number, council_state)` é
 * UNIQUE em **toda a rede LogiFit** (não por tenant). Detecta fraude de
 * profissional registrado em 2 tenants com mesmo número (clone).
 *
 * **Uma pessoa pode ter N registros** — profissional dual (fisio + PT;
 * médico em 2 UFs; nutri + esteticista).
 *
 * Sprint 01b: schema + UI básica de cadastro/atestação.
 * Sprint 20+: gate de assinatura clínica consome `situation='active'`.
 */
import { sql } from 'drizzle-orm'
import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity'
import { persons } from './persons'

export const councilBodyEnum = pgEnum('council_body', [
  'CRM', // médico
  'CRN', // nutricionista
  'CREFITO', // fisioterapeuta
  'CREF', // educador físico / personal
  // Preparados pra fases futuras (sem seed inicial de dados):
  'CRF', // farmacêutico
  'CRP', // psicólogo
  'COREN', // enfermeiro
  'CRO', // dentista
])

export const verificationSourceEnum = pgEnum('verification_source', [
  'operator_attested', // MVP — admin valida + atesta
  'council_api', // futuro — integração API conselho (Sprint 20+)
  'manual_audit', // auditoria reativa pós-incidente
])

export const professionalSituationEnum = pgEnum('professional_situation', [
  'active',
  'suspended', // por conselho — bloqueia gate clínico
  'cassated', // cassado — bloqueia tudo
  'expired', // anuidade não paga
  'pending_verification', // cadastrado mas não atestado ainda
  'unknown', // legado / importação
])

export const professionalRegistrations = pgTable(
  'professional_registrations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),

    councilBody: councilBodyEnum('council_body').notNull(),
    councilNumber: text('council_number').notNull(),
    councilState: text('council_state').notNull(), // UF (SP, RJ, MG, ...)
    specialty: text('specialty'), // 'cardiologia', 'pediatria', etc — texto livre
    cboCode: text('cbo_code'), // Classificação Brasileira de Ocupações

    situation: professionalSituationEnum('situation').notNull().default('pending_verification'),

    issuedAt: date('issued_at'), // quando o conselho emitiu
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verificationSource: verificationSourceEnum('verification_source')
      .notNull()
      .default('operator_attested'),

    validUntil: date('valid_until'), // anuidade — alerta D-30
    documentStoragePath: text('document_storage_path'), // bucket professional-docs

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Constraint global — mesmo número em 2 tenants = fraude detectada
    uniqueIndex('professional_registrations_global_uq').on(
      t.councilBody,
      t.councilNumber,
      t.councilState,
    ),
    index('professional_registrations_tenant_person_idx').on(t.tenantId, t.personId),
    index('professional_registrations_person_idx').on(t.personId),
    // Lookup rápido por situação (gate clínico)
    index('professional_registrations_situation_idx').on(t.situation),
  ],
)

export type ProfessionalRegistrationRow = typeof professionalRegistrations.$inferSelect
export type ProfessionalRegistrationInsert = typeof professionalRegistrations.$inferInsert
