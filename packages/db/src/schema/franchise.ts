/**
 * `franchise_agreements` — Sprint 01b.
 *
 * Contrato entre franqueador (matriz) e franqueado (filial) num tenant com
 * `topology='franchise'`. Regula:
 *   - **cross-company access**: passaporte de aluno (intra-tenant) permitindo
 *     aluno levar treino entre filiais
 *   - **royalties**: percentual da receita da filial pago à matriz
 *   - **taxa fixa** mensal
 *   - **financial_mode**: distributed (filial controla próprio fiscal) vs
 *     centralized (matriz controla)
 *
 * **Regra 25 (clínico NÃO cruza company em franchise)** continua valendo
 * mesmo quando `cross_company_access=true`. Acordo cobre só financeiro +
 * passaporte de aluno academia (sem clínico).
 *
 * Sprint 16+ (Rateio intercompany) consome este schema pra calcular
 * royalties + lançamentos automáticos.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies } from './identity'

export const franchiseAgreements = pgTable(
  'franchise_agreements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),

    // Acordo entre franqueador (matriz) e franqueado (filial)
    franqueadorCompanyId: uuid('franqueador_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    franqueadoCompanyId: uuid('franqueado_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    // Termos
    royaltyPercentage: numeric('royalty_percentage', { precision: 5, scale: 2 }), // 0-100
    fixedMonthlyFeeCents: numeric('fixed_monthly_fee_cents', { precision: 12, scale: 0 }),
    crossCompanyAccess: boolean('cross_company_access').notNull().default(false),

    startedAt: date('started_at').notNull(),
    endsAt: date('ends_at'), // NULL = sem fim definido (renovação automática)

    // Metadata flexível (Sprint 16+ amplia)
    metadata: jsonb('metadata'),

    // Audit
    signedByUserId: uuid('signed_by_user_id'), // who created the contract
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminationReason: text('termination_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 acordo ativo por par (franqueador, franqueado) — terminated_at = histórico
    uniqueIndex('franchise_agreements_pair_active_uq')
      .on(t.franqueadorCompanyId, t.franqueadoCompanyId)
      .where(sql`${t.terminatedAt} IS NULL`),
    index('franchise_agreements_tenant_idx').on(t.tenantId),
    index('franchise_agreements_franqueador_idx').on(t.franqueadorCompanyId),
    index('franchise_agreements_franqueado_idx').on(t.franqueadoCompanyId),
  ],
)

export type FranchiseAgreementRow = typeof franchiseAgreements.$inferSelect
