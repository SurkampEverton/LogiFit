/**
 * TISS/TUSS + Convênios (ANS) — Sprint 22 Faixa A (ADRs 0029/0030/0031 esperados).
 *
 * 11 tabelas:
 *   - insurance_plans (global LogiFit + tenant editável)
 *   - tuss_catalog (global versionado por release ANS)
 *   - tuss_catalog_imports (audit dos imports semestrais)
 *   - insurance_agreements (tenant ↔ plano + condições financeiras)
 *   - insurance_procedure_prices (preço por procedimento por acordo)
 *   - member_insurances (carteirinha do paciente)
 *   - authorizations (pedido autorização ao plano)
 *   - billing_guides (guia consulta ou SP/SADT)
 *   - billing_guide_items (itens da guia)
 *   - billing_batches (lote enviado à operadora)
 *   - billing_glosas (motivos de glosa + recurso)
 *
 * **ADR 0079 Accepted (TISS 4.01 vigente)** — versão padrão atual.
 * **Ofício-Circular ANS nº 1/2026** — release vigente jan/2026.
 *
 * **Particionamento `billing_guides`** (regra 34 + ADR 0072):
 *   - 1k tenants × 200 guias/mês × 12 = 2.4M+ linhas/ano
 *   - PARTITION BY RANGE (created_at) trimestral via migration manual
 *   - Retenção fiscal 5a hot + cold storage
 *
 * **Gate ADR 0055** — `generateGuide` consome `professional_registrations.cbo_code`
 * + `council_body` + `council_number` + `council_state` pra preencher campos
 * obrigatórios TISS 4.01 (NumeroConselhoProfissional, SiglaConselho, UF, CBOS).
 *
 * **Regra 43 (MFA recente <15min):** cancelamento de guia + ajuste valor após
 * envio são high-risk — Server Action checa via `requireRecentMfa()`.
 *
 * @volume_estimate_yearly: 2400000
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
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { appointments } from './agenda'
import { invoices } from './financeiro'
import { companies, users } from './identity'
import { members } from './members'

// ─── Enums ───────────────────────────────────────────────────────────────

export const tussCategoryEnum = pgEnum('tuss_category', [
  'procedimento', // procedimentos médicos / fisio / consultas
  'opme', // órteses/próteses/materiais especiais (+26k termos no Ofício 2026)
  'medicamento', // +334 novos no Ofício 1/2026
  'taxa_diaria',
  'gasoterapia',
])

export const tussImportSourceEnum = pgEnum('tuss_import_source', [
  'ans_oficio_circular',
  'manual',
])

export const guideKindEnum = pgEnum('billing_guide_kind', [
  'consulta', // guia de consulta
  'sp_sadt', // serviços profissionais / auxiliar diagnóstico e terapia
  'honorario', // honorários individuais (futuro)
  'internacao', // futuro (Sprint 22+)
])

export const guideStatusEnum = pgEnum('billing_guide_status', [
  'draft',
  'ready', // validador passou, pronto pra envio
  'sent',
  'paid',
  'partially_paid',
  'fully_glossed',
  'cancelled',
])

export const authorizationStatusEnum = pgEnum('authorization_status', [
  'pending',
  'approved',
  'denied',
  'expired',
])

export const batchStatusEnum = pgEnum('batch_status', [
  'draft',
  'sent',
  'returned',
  'cancelled',
])

export const glosaStatusEnum = pgEnum('glosa_status', [
  'glossed', // recebida
  'recurring', // recurso aberto
  'recovered', // operadora aceitou recurso
  'lost', // recurso negado / prazo expirou
])

// ─── insurance_plans (global) ───────────────────────────────────────────

export const insurancePlans = pgTable(
  'insurance_plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Null = global LogiFit; UUID = customizado por tenant */
    tenantId: uuid('tenant_id'),
    name: text('name').notNull(),
    /** Código ANS de operadora (registro junto à ANS) */
    ansCode: text('ans_code'),
    /** Versão TISS aceita pelo plano */
    tissVersion: text('tiss_version').notNull().default('4.01'),
    /** True = plano nacional (Unimed Brasil etc); false = regional */
    national: boolean('national').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('insurance_plans_active_idx').on(t.active),
    uniqueIndex('insurance_plans_ans_uq').on(t.ansCode).where(sql`ans_code IS NOT NULL`),
  ],
)

// ─── tuss_catalog (global versionado) ──────────────────────────────────

export const tussCatalog = pgTable(
  'tuss_catalog',
  {
    code: text('code').notNull(),
    description: text('description').notNull(),
    category: tussCategoryEnum('category').notNull(),
    /** Versão semestral (ex: '2026.01' = release jan/2026, '2026.07' = jul/2026) */
    version: text('version').notNull(),
    active: boolean('active').notNull().default(true),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    /** Especialidades a que o procedimento se aplica (filtra na geração de guia) */
    specialties: text('specialties').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.code, t.version] }),
    index('tuss_category_idx').on(t.category, t.version),
    index('tuss_active_idx').on(t.active, t.version),
  ],
)

// ─── tuss_catalog_imports (audit dos imports) ──────────────────────────

export const tussCatalogImports = pgTable(
  'tuss_catalog_imports',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    version: text('version').notNull(),
    source: tussImportSourceEnum('source').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    importedByUserId: uuid('imported_by_user_id').references(() => users.id),
    itemsAdded: integer('items_added').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsDeactivated: integer('items_deactivated').notNull().default(0),
    importLog: text('import_log'),
  },
  (t) => [
    uniqueIndex('tuss_imports_version_source_uq').on(t.version, t.source),
    index('tuss_imports_at_idx').on(t.importedAt),
  ],
)

// ─── insurance_agreements ──────────────────────────────────────────────

export const insuranceAgreements = pgTable(
  'insurance_agreements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => insurancePlans.id, { onDelete: 'restrict' }),
    /** Número do contrato com a operadora */
    contractNumber: text('contract_number'),
    /** Credentials cifradas (Sprint 22b SOAP automação) */
    credentialsEncrypted: jsonb('credentials_encrypted'),
    /** Prazo de pagamento em dias úteis após envio do lote */
    paymentTermDays: integer('payment_term_days').notNull().default(30),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agreement_tenant_company_idx').on(t.tenantId, t.companyId),
    uniqueIndex('agreement_company_plan_uq')
      .on(t.companyId, t.planId)
      .where(sql`active = true`),
  ],
)

// ─── insurance_procedure_prices ────────────────────────────────────────

export const insuranceProcedurePrices = pgTable(
  'insurance_procedure_prices',
  {
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => insuranceAgreements.id, { onDelete: 'cascade' }),
    tussCode: text('tuss_code').notNull(),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    patientCopayCents: bigint('patient_copay_cents', { mode: 'number' }),
    authRequired: boolean('auth_required').notNull().default(false),
    /** Limite de sessões por autorização */
    maxSessionsPerAuth: integer('max_sessions_per_auth'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agreementId, t.tussCode] }),
    check('ipp_price_positive', sql`price_cents >= 0`),
  ],
)

// ─── member_insurances ─────────────────────────────────────────────────

export const memberInsurances = pgTable(
  'member_insurances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => insurancePlans.id, { onDelete: 'restrict' }),
    /** Número da carteirinha (sem máscara) */
    cardNumber: text('card_number').notNull(),
    /** Categoria do plano (apartamento/enfermaria/básico/executivo) */
    category: text('category'),
    /** Validade da carteirinha */
    validUntil: date('valid_until'),
    /** Plano de saúde do titular (quando member é dependente) */
    holderName: text('holder_name'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mi_tenant_member_idx').on(t.tenantId, t.memberId),
    uniqueIndex('mi_member_plan_card_uq').on(t.memberId, t.planId, t.cardNumber),
  ],
)

// ─── authorizations ────────────────────────────────────────────────────

export const authorizations = pgTable(
  'authorizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberInsuranceId: uuid('member_insurance_id')
      .notNull()
      .references(() => memberInsurances.id, { onDelete: 'restrict' }),
    tussCode: text('tuss_code').notNull(),
    quantityRequested: integer('quantity_requested').notNull(),
    quantityAuthorized: integer('quantity_authorized'),
    quantityUsed: integer('quantity_used').notNull().default(0),
    /** Número da senha/autorização da operadora */
    authorizationNumber: text('authorization_number'),
    status: authorizationStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    deniedAt: timestamp('denied_at', { withTimezone: true }),
    denialReason: text('denial_reason'),
    validUntil: date('valid_until'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('auth_tenant_status_idx').on(t.tenantId, t.status),
    index('auth_member_insurance_idx').on(t.memberInsuranceId, t.requestedAt),
    check('auth_qty_positive', sql`quantity_requested > 0`),
    check('auth_qty_used_le_authorized',
      sql`(quantity_authorized IS NULL OR quantity_used <= quantity_authorized)`),
  ],
)

// ─── billing_guides ────────────────────────────────────────────────────

export const billingGuides = pgTable(
  'billing_guides',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    memberInsuranceId: uuid('member_insurance_id')
      .notNull()
      .references(() => memberInsurances.id, { onDelete: 'restrict' }),
    kind: guideKindEnum('kind').notNull(),
    /** Número da guia gerado pelo prestador (sequencial) */
    guideNumber: text('guide_number').notNull(),
    /** Número fornecido pela operadora após processamento */
    operatorGuideNumber: text('operator_guide_number'),
    authorizationId: uuid('authorization_id').references(() => authorizations.id, {
      onDelete: 'set null',
    }),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    copayCents: bigint('copay_cents', { mode: 'number' }).notNull().default(0),
    /** Co-participação vira invoice automaticamente (Sprint 04) */
    copayInvoiceId: uuid('copay_invoice_id').references(() => invoices.id, {
      onDelete: 'set null',
    }),
    status: guideStatusEnum('status').notNull().default('draft'),
    /** XML gerado (cached) */
    xmlSent: text('xml_sent'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** Valor efetivamente pago pela operadora (pode ser < totalCents por glosa) */
    paidAmountCents: bigint('paid_amount_cents', { mode: 'number' }),
    /** Snapshot do profissional executante (council_body/state/number/cbo_code) — TISS 4.01 obrigatório */
    professionalSnapshot: jsonb('professional_snapshot'),
    /** tuss_catalog_version vigente no momento da geração — rastreabilidade */
    tussVersion: text('tuss_version').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bg_tenant_number_uq').on(t.tenantId, t.guideNumber),
    index('bg_tenant_status_idx').on(t.tenantId, t.status),
    index('bg_member_idx').on(t.memberId, t.createdAt),
    check('bg_total_positive', sql`total_cents >= 0`),
    check(
      'bg_paid_le_total',
      sql`(paid_amount_cents IS NULL OR paid_amount_cents <= total_cents)`,
    ),
  ],
)

// ─── billing_guide_items ───────────────────────────────────────────────

export const billingGuideItems = pgTable(
  'billing_guide_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    guideId: uuid('guide_id')
      .notNull()
      .references(() => billingGuides.id, { onDelete: 'cascade' }),
    /** Ordem dentro da guia (1..N) — usado no XML como sequencial */
    sequenceNumber: integer('sequence_number').notNull(),
    tussCode: text('tuss_code').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    professionalUserId: uuid('professional_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Snapshot CBOS no momento da geração */
    cbosCode: text('cbos_code'),
  },
  (t) => [
    uniqueIndex('bgi_guide_seq_uq').on(t.guideId, t.sequenceNumber),
    index('bgi_tuss_idx').on(t.tussCode),
    check('bgi_qty_positive', sql`quantity > 0`),
    check('bgi_total_consistent', sql`total_cents = quantity * unit_price_cents`),
  ],
)

// ─── billing_batches ───────────────────────────────────────────────────

export const billingBatches = pgTable(
  'billing_batches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => insuranceAgreements.id, { onDelete: 'restrict' }),
    batchNumber: text('batch_number').notNull(),
    /** UUIDs das guias incluídas */
    guideIds: uuid('guide_ids').array().notNull(),
    /** XML do lote (cached) */
    xml: text('xml').notNull(),
    status: batchStatusEnum('status').notNull().default('draft'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnXml: text('return_xml'),
    /** Versão TISS usada no envio */
    tissVersion: text('tiss_version').notNull(),
    sentByUserId: uuid('sent_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bb_tenant_number_uq').on(t.tenantId, t.batchNumber),
    index('bb_agreement_status_idx').on(t.agreementId, t.status, t.sentAt),
  ],
)

// ─── billing_glosas ────────────────────────────────────────────────────

export const billingGlosas = pgTable(
  'billing_glosas',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    guideId: uuid('guide_id')
      .notNull()
      .references(() => billingGuides.id, { onDelete: 'restrict' }),
    guideItemId: uuid('guide_item_id').references(() => billingGuideItems.id, {
      onDelete: 'set null',
    }),
    /** Código de glosa ANS */
    reasonCode: text('reason_code').notNull(),
    reasonDescription: text('reason_description').notNull(),
    amountGlossedCents: bigint('amount_glossed_cents', { mode: 'number' }).notNull(),
    status: glosaStatusEnum('status').notNull().default('glossed'),
    /** Corpo do recurso enviado à operadora */
    recursoBody: text('recurso_body'),
    recursoAt: timestamp('recurso_at', { withTimezone: true }),
    recursoByUserId: uuid('recurso_by_user_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNotes: text('resolution_notes'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bgl_tenant_status_idx').on(t.tenantId, t.status, t.receivedAt),
    index('bgl_guide_idx').on(t.guideId),
    check('bgl_amount_positive', sql`amount_glossed_cents > 0`),
  ],
)
