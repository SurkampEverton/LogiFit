/**
 * `persons` — cadastro central PF/PJ (ADR 0047).
 *
 * Toda entidade especializada (user, member, supplier, company, lead,
 * profissional) tem FK `person_id → persons.id`. Sem duplicação de identidade.
 *
 * Constraint: documento (CPF/CNPJ) é unique POR TENANT — não global aqui;
 * unicidade global vive em `companies.person_id` quando aplicável (ver
 * `identity.ts` + ADR 0047 §unicidade CNPJ).
 *
 * RLS: `tenant_id = current_setting('app.tenant_id', true)::uuid` (regra 1).
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const personKindEnum = pgEnum('person_kind', ['pf', 'pj'])

/**
 * Campos sensíveis (PII) marcados com `pii_eligible_for_anonymization = true`
 * são limpos pelo job `anonymize_trial_data()` quando trial expira (ADR 0066).
 * Aqui não é coluna SQL — é convenção semântica enforced pelo job.
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),

    kind: personKindEnum('kind').notNull(),

    // PII — pseudonimizado em trial expirado (ADR 0066)
    name: text('name').notNull(), // nome completo OU razão social
    displayName: text('display_name'), // apelido OU nome fantasia
    document: text('document'), // 11 dígitos (CPF) ou 14 (CNPJ) — sem formatação
    birthDate: date('birth_date'), // só PF
    sex: text('sex'), // só PF — texto livre (LGPD: não inferir)
    email: text('email'),
    phone: text('phone'),
    address: jsonb('address'), // {cep, logradouro, numero, complemento, bairro, cidade, uf}

    // Operacional
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unicidade do documento por tenant (regra 22 + ADR 0047).
    // Documento pode ser NULL (cadastros parciais antes do operador ter dado completo).
    uniqueIndex('persons_tenant_document_uq')
      .on(t.tenantId, t.document)
      .where(sql`${t.document} IS NOT NULL`),
  ],
)

/**
 * Visão tipada PF/PJ helper — não cria tabela, mas useful para refinement em
 * Server Actions:
 *   const p = await db.select().from(persons).where(...)
 *   if (p.kind === 'pj') { ... }
 */
export type PersonRow = typeof persons.$inferSelect
export type PersonInsert = typeof persons.$inferInsert
