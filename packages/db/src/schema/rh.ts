/**
 * Comissões e repasse profissional — Sprint 23 Faixa A (ADR 0086 esperado).
 *
 * 4 tabelas:
 *   - professional_contracts — contrato do profissional com a company (1..N por pessoa)
 *   - commission_rules — overrides por service_type/tuss_code sobre default do contrato
 *   - commission_entries — uma linha por evento gerador (atendimento/pagamento)
 *   - commission_periods — fechamento mensal agregado pra pagamento
 *
 * **ADR 0086 esperado** — 4 kinds (percent_faturamento / percent_recebido /
 * fixo_por_atendimento / tabela_por_servico) × 4 bases (faturado /
 * recebido_particular / recebido_convenio / misto). Versão imutável após
 * approved.
 *
 * **Gate ADR 0055** — `createProfessionalContract` valida `professional_registrations`
 * ativo coerente com `service_type` do contrato (fisio→CREFITO, personal→CREF,
 * nutri→CRN, medico→CRM). Falta = erro acionável.
 *
 * **Retenções tributárias (ADR 0061)** — `commission_entries.tax_nature_id`
 * resolvido por person.kind + regime do profissional. Sprint 23a calcula
 * apenas valor bruto + persiste `tax_nature_id` placeholder; Sprint 23b
 * integra `calculateRetentions()` real do Sprint 15 (ADR 0061).
 *
 * **Imutabilidade pós-approved** — Sprint 23b adiciona trigger BEFORE UPDATE
 * que bloqueia mutação de entries em period.status='approved'|'paid'.
 *
 * **Particionamento `commission_entries`** (regra 34 + ADR 0072):
 *   - 1k tenants × 50 profissionais × 30 entries/mês × 12 = 18M+ linhas/ano
 *   - PARTITION BY RANGE (earned_at) trimestral via migration manual
 *   - Retenção 5a hot (fiscal)
 *
 * **Regra 25 (franchise)** — profissional de uma company NÃO recebe de
 * atendimento em outra company. RLS limita ao tenant; calculadora filtra
 * por company_id ao agregar entries no period.
 *
 * @volume_estimate_yearly: 18000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
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
import { companies, users } from './identity'
import { persons } from './persons'

// ─── Enums ───────────────────────────────────────────────────────────────

export const commissionContractKindEnum = pgEnum('commission_contract_kind', [
  'percent_faturamento', // % sobre valor faturado (independente de receber)
  'percent_recebido', // % sobre valor efetivamente recebido (particular ou convênio)
  'fixo_por_atendimento', // R$ X por atendimento realizado, independente de valor
  'tabela_por_servico', // valor diferente por service_type (commission_rules definem)
])

export const commissionBaseEnum = pgEnum('commission_base', [
  'faturado', // total emitido (invoices + billing_guides)
  'recebido_particular', // só pagamentos particulares
  'recebido_convenio', // só pagamentos de convênio (billing_guides.paid_amount_cents)
  'misto', // qualquer recebimento conta
])

export const commissionEntryStatusEnum = pgEnum('commission_entry_status', [
  'pending', // calculada mas ainda não incluída em period
  'included', // dentro de period draft/approved
  'excluded', // operador excluiu manualmente
  'reversed', // glosa/refund estornou
])

export const commissionPeriodStatusEnum = pgEnum('commission_period_status', [
  'draft',
  'approved',
  'paid',
  'cancelled',
])

// ─── professional_contracts ─────────────────────────────────────────────

export const professionalContracts = pgTable(
  'professional_contracts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** Pessoa cadastral do profissional (ADR 0047) — sempre obrigatório */
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    /** User opcional — preenchido quando profissional tem login no LogiFit */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** service_type cobre fisioterapia/personal/nutricao/medicina/enfermagem */
    serviceType: text('service_type').notNull(),
    kind: commissionContractKindEnum('kind').notNull(),
    base: commissionBaseEnum('base').notNull().default('recebido_particular'),
    /** Default % (0-100) ou valor fixo cents — um deles obrigatório por kind */
    defaultPercent: numeric('default_percent', { precision: 5, scale: 2 }),
    defaultAmountCents: bigint('default_amount_cents', { mode: 'number' }),
    /** Versionamento — UPDATE cria nova row com version+1 (imutabilidade pós-approved) */
    version: integer('version').notNull().default(1),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    active: boolean('active').notNull().default(true),
    /** Metadata opcional (ex: política de glosa, abatimento no-show etc) */
    metadata: jsonb('metadata'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pc_tenant_person_idx').on(t.tenantId, t.personId, t.active),
    index('pc_tenant_company_idx').on(t.tenantId, t.companyId, t.active),
    uniqueIndex('pc_person_company_service_version_uq').on(
      t.personId,
      t.companyId,
      t.serviceType,
      t.version,
    ),
    // Pelo menos default_percent OU default_amount_cents deve estar preenchido conforme kind
    check(
      'pc_default_consistent',
      sql`(
        (kind IN ('percent_faturamento','percent_recebido') AND default_percent IS NOT NULL AND default_percent > 0 AND default_percent <= 100) OR
        (kind = 'fixo_por_atendimento' AND default_amount_cents IS NOT NULL AND default_amount_cents > 0) OR
        (kind = 'tabela_por_servico')
      )`,
    ),
    check('pc_effective_range', sql`(effective_to IS NULL OR effective_to >= effective_from)`),
  ],
)

// ─── commission_rules (overrides) ───────────────────────────────────────

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => professionalContracts.id, { onDelete: 'cascade' }),
    /** Específico de tipo de serviço (ex: 'sessao_fisio_individual', 'avaliacao_inicial') */
    serviceType: text('service_type'),
    /** Específico de TUSS code (ex: '20104073' = sessão fisio individual) */
    tussCode: text('tuss_code'),
    /** Override %: 0-100 */
    percent: numeric('percent', { precision: 5, scale: 2 }),
    /** Override valor fixo cents */
    amountCents: bigint('amount_cents', { mode: 'number' }),
    /** Prioridade: rule com priority menor prevalece */
    priority: integer('priority').notNull().default(100),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cr_contract_priority_idx').on(t.contractId, t.priority).where(sql`active = true`),
    check('cr_at_least_one', sql`(service_type IS NOT NULL OR tuss_code IS NOT NULL)`),
    check('cr_value_provided', sql`(percent IS NOT NULL OR amount_cents IS NOT NULL)`),
  ],
)

// ─── commission_entries ────────────────────────────────────────────────

export const commissionEntries = pgTable(
  'commission_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => professionalContracts.id, { onDelete: 'restrict' }),
    /** Denormalizado pra relatórios rápidos sem JOIN */
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** Referência opaca ao evento que gerou (ex: 'payment:uuid', 'guide:uuid', 'consulta:uuid') */
    sourceEventRef: text('source_event_ref').notNull(),
    /** Valor de referência (base do cálculo) em centavos */
    referenceAmountCents: bigint('reference_amount_cents', { mode: 'number' }).notNull(),
    /** Comissão bruta calculada (antes de retenções) */
    commissionCents: bigint('commission_cents', { mode: 'number' }).notNull(),
    /** % aplicada (null se kind=fixo) */
    percentApplied: numeric('percent_applied', { precision: 5, scale: 2 }),
    /** service_type / tuss_code resolvidos */
    serviceType: text('service_type'),
    tussCode: text('tuss_code'),
    /** Natureza tributária (ADR 0061) — Sprint 23b integra calculateRetentions real */
    taxNatureId: uuid('tax_nature_id'),
    /** Total de retenções federais + ISS (default 0 no MVP) */
    retentionTotalCents: bigint('retention_total_cents', { mode: 'number' }).notNull().default(0),
    /** Líquido (commission_cents - retention_total_cents) */
    netAmountCents: bigint('net_amount_cents', { mode: 'number' }).notNull(),
    status: commissionEntryStatusEnum('status').notNull().default('pending'),
    periodId: uuid('period_id'),
    /** Quando a entry foi criada/ganha (evento original) */
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
    /** Reason quando excluded/reversed */
    reversalReason: text('reversal_reason'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedByUserId: uuid('reversed_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ce_tenant_person_period_idx').on(t.tenantId, t.personId, t.periodId),
    index('ce_tenant_status_idx').on(t.tenantId, t.status, t.earnedAt),
    index('ce_contract_idx').on(t.contractId, t.earnedAt),
    uniqueIndex('ce_source_event_uq').on(t.contractId, t.sourceEventRef),
    check('ce_commission_positive_or_zero', sql`commission_cents >= 0`),
    check('ce_net_consistent', sql`net_amount_cents = commission_cents - retention_total_cents`),
    check('ce_reference_positive', sql`reference_amount_cents >= 0`),
  ],
)

// ─── commission_periods ────────────────────────────────────────────────

export const commissionPeriods = pgTable(
  'commission_periods',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    totalEntries: integer('total_entries').notNull().default(0),
    grossTotalCents: bigint('gross_total_cents', { mode: 'number' }).notNull().default(0),
    deductionsCents: bigint('deductions_cents', { mode: 'number' }).notNull().default(0),
    retentionTotalCents: bigint('retention_total_cents', { mode: 'number' }).notNull().default(0),
    netTotalCents: bigint('net_total_cents', { mode: 'number' }).notNull().default(0),
    status: commissionPeriodStatusEnum('status').notNull().default('draft'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** ID da transferência Asaas (Sprint 23b integra real) */
    asaasTransferId: text('asaas_transfer_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cp_person_company_period_uq').on(
      t.personId,
      t.companyId,
      t.periodStart,
      t.periodEnd,
    ),
    index('cp_tenant_status_idx').on(t.tenantId, t.status, t.periodStart),
    check('cp_period_range', sql`period_end >= period_start`),
    check(
      'cp_net_consistent',
      sql`net_total_cents = gross_total_cents - deductions_cents - retention_total_cents`,
    ),
  ],
)
