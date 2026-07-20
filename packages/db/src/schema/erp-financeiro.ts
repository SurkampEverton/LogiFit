/**
 * ERP Financeiro Core — Sprint 15 Faixa A (ADR 0033 + ADR 0034).
 *
 * **Escopo MVP Sprint 15a (este arquivo):**
 *   - chart_of_accounts (hierárquico self-referencing + is_leaf)
 *   - suppliers (FK persons — ADR 0047)
 *   - approval_rules (DSL declarativa por faixa de valor + roles aprovadores)
 *   - accounts_payable (com workflow state machine + approval_trace jsonb)
 *   - accounts_receivable (AR avulso, separado de invoices contratos)
 *   - ap_ar_payments (pagamentos parciais)
 *
 * **Adiado Sprint 15b/17/36:**
 *   - `nfe_received` (ADR 0056) — inbox NF-e: Sprint 15b
 *   - `nfe_returns` (ADR 0058) — devoluções: Sprint 15b
 *   - `fiscal_emissions` / `fiscal_events` / `fiscal_numbering_sequences` (ADR 0059) — Sprint 36
 *   - `tax_natures` / `tax_retentions` (ADR 0061) — Sprint 15b com colunas pré-cabeadas em AP
 *   - OCR provider (ADR 0035) — Sprint 15b
 *
 * **Plano de contas hierárquico** (ADR 0033 esperado): `parent_id` self-FK
 * + `is_leaf bool` (lançamentos AP/AR só apontam pra folha). Seed brasileiro
 * simplificado ~60 contas no Sprint 15 Faixa D.
 *
 * **Workflow AP** (ADR 0034 esperado): `approval_rules` JSON `required_approvers`
 * (array ordenada de roles ou user_ids) + faixa de valor. State machine:
 * draft → pending_approval → approved (ou rejected) → scheduled → paid → reconciled.
 * `approval_trace jsonb` registra histórico (quem aprovou, quando, comentário).
 *
 * **AR avulso** vs `invoices` (Sprint 04 — contratos): mesmo dashboard, schemas
 * separados. AR cobre aluguel recebido, venda esporádica, reembolso — sem
 * vínculo com contract/plan.
 *
 * @volume_estimate_yearly: 2000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, units, users } from './identity'
import { persons } from './persons'

// ─── Enums ───────────────────────────────────────────────────────────────

export const chartAccountKindEnum = pgEnum('chart_account_kind', [
  'ativo', // bens + direitos (caixa, banco, estoque)
  'passivo', // obrigações (fornecedores, empréstimos)
  'receita', // entradas (mensalidade, venda, juros)
  'despesa', // saídas operacionais (aluguel, folha, marketing)
  'custo', // custos diretos (insumos, serviços contratados)
])

export const approvalRuleScopeEnum = pgEnum('approval_rule_scope', ['ap', 'ar', 'both'])

export const apStatusEnum = pgEnum('ap_status', [
  'draft', // criada, ainda não submetida
  'pending_approval', // aguardando aprovação
  'approved', // aprovada pelo workflow
  'rejected', // rejeitada
  'scheduled', // pagamento agendado
  'paid', // paga
  'cancelled', // cancelada antes do pagamento
  'reconciled', // conciliada com extrato bancário
])

export const arStatusEnum = pgEnum('ar_status', [
  'draft',
  'issued', // boleto/PIX emitido (via Asaas)
  'received', // valor recebido
  'overdue', // vencida
  'cancelled',
  'refunded',
])

export const apSourceEnum = pgEnum('ap_source', [
  'manual', // operador cadastrou
  'ocr_boleto', // OCR de PDF/imagem (Sprint 15b)
  'nfe_upload', // upload XML NF-e (Sprint 15b)
  'nfe_manual_key', // chave NF-e manual (Sprint 15b)
  'nfe_sefaz', // download automático SEFAZ (Sprint 17)
  'recurring', // gerado por cron de recorrência (futuro)
])

export const apPaymentMethodEnum = pgEnum('ap_payment_method', [
  'pix',
  'ted',
  'doc',
  'boleto',
  'cash',
  'credit_card',
  'manual_other', // pagamento externo registrado a posteriori
])

// ─── chart_of_accounts (plano de contas hierárquico — ADR 0033) ─────────
/**
 * `code text` é a chave humana ("1.1.01" — caixa). Único por tenant. Seed
 * brasileiro simplificado entrega ~60 contas.
 *
 * `parent_id` self-FK: NULL = raiz (5 raízes canônicas — uma por kind).
 * `is_leaf bool`: lançamentos AP/AR só apontam pra contas onde is_leaf=true.
 * Trigger Sprint 15+ pode validar; MVP confia no schema seed + Server Action.
 *
 * `kind` enum herda da raiz (ativo/passivo/receita/despesa/custo). Mesmo
 * tenant pode ter "5.1.01 Aluguel" (despesa) e "1.1.02 Banco" (ativo).
 */
export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: chartAccountKindEnum('kind').notNull(),
    parentId: uuid('parent_id'),
    isLeaf: boolean('is_leaf').notNull().default(true),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chart_of_accounts_tenant_code_uq').on(t.tenantId, t.code),
    index('chart_of_accounts_tenant_kind_idx').on(t.tenantId, t.kind),
    index('chart_of_accounts_parent_idx').on(t.parentId),
    index('chart_of_accounts_leaves_idx')
      .on(t.tenantId, t.kind)
      .where(sql`is_leaf = true AND active = true`),
  ],
)

// ─── suppliers (fornecedores — FK persons) ──────────────────────────────
/**
 * Identidade vem 100% de `persons` (ADR 0047) — `person.kind` discrimina
 * PF/PJ, `person.document` = CPF/CNPJ, name/email/phone/address já lá.
 * `suppliers` adiciona apenas dados comerciais específicos.
 *
 * `company_id nullable`: fornecedor específico de uma filial da rede.
 * NULL = compartilhado pelo tenant inteiro.
 *
 * `bank_account jsonb`: `{pixKey?, bank?, agency?, account?, type?}`.
 * Sprint 17 (Open Finance) consome pra automatizar transferências.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    defaultPaymentMethod: apPaymentMethodEnum('default_payment_method'),
    defaultPaymentTermDays: bigint('default_payment_term_days', { mode: 'number' }),
    bankAccount: jsonb('bank_account'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('suppliers_tenant_person_uq').on(t.tenantId, t.personId),
    index('suppliers_tenant_company_idx').on(t.tenantId, t.companyId),
    index('suppliers_active_idx').on(t.tenantId).where(sql`archived_at IS NULL`),
  ],
)

// ─── approval_rules (workflow declarativo — ADR 0034) ───────────────────
/**
 * Cada rule define faixa de valor + aprovadores requeridos.
 *
 * `required_approvers jsonb` formato:
 * ```json
 * { "mode": "series" | "parallel",
 *   "approvers": [
 *     { "role": "gerente_financeiro" },
 *     { "role": "diretor", "company_id": "uuid-opcional" },
 *     { "user_id": "uuid-pessoa-especifica" }
 *   ]
 * }
 * ```
 *
 * MVP: 1 rule por faixa de valor; multiplas regras concorrentes resolvem
 * pela rule de menor `max_amount_cents` que cobre o valor da AP.
 *
 * `company_id nullable`: regra específica por filial.
 */
export const approvalRules = pgTable(
  'approval_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    scope: approvalRuleScopeEnum('scope').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    minAmountCents: bigint('min_amount_cents', { mode: 'number' }).notNull(),
    maxAmountCents: bigint('max_amount_cents', { mode: 'number' }),
    requiredApprovers: jsonb('required_approvers').notNull(),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('approval_rules_tenant_scope_idx').on(t.tenantId, t.scope).where(sql`active = true`),
    check('approval_rules_min_non_negative', sql`${t.minAmountCents} >= 0`),
    check(
      'approval_rules_max_after_min',
      sql`${t.maxAmountCents} IS NULL OR ${t.maxAmountCents} >= ${t.minAmountCents}`,
    ),
  ],
)

// ─── accounts_payable ───────────────────────────────────────────────────
/**
 * `amount_cents` = valor BRUTO. `retention_total_cents` = soma de retenções
 * (Sprint 15b ADR 0061). `net_amount_cents` = valor líquido a pagar.
 *
 * MVP: `retention_total_cents=0` e `net_amount_cents=amount_cents`. Coluna
 * `tax_nature_id` pré-cabeada (NULL no Sprint 15a) — Sprint 15b liga calculadora.
 *
 * `chart_account_id` obrigatória — todo AP tem destino contábil.
 *
 * `approval_trace jsonb` formato:
 * ```json
 * [
 *   { "at": "2026-05-14T10:00", "by_user_id": "...", "action": "submitted" },
 *   { "at": "2026-05-14T14:00", "by_user_id": "...", "action": "approved", "comment": "..." }
 * ]
 * ```
 *
 * `doc_key text` unique global pra evitar duplicata de NF-e entre tenants.
 *
 * `no_invoice bool` (ADR 0056 — entrada manual sem nota fiscal): true =
 * AP criada sem NF (gastos diversos sem documento fiscal).
 *
 * **Particionamento** Sprint 16+ por RANGE due_date quando volume justificar
 * (regra 34 + ADR 0072). >5M rows/ano em rede grande.
 */
export const accountsPayable = pgTable(
  'accounts_payable',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    chartAccountId: uuid('chart_account_id')
      .notNull()
      .references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** Sprint 15b — FK pra tax_natures (ADR 0061). NULL no MVP. */
    taxNatureId: uuid('tax_nature_id'),
    retentionTotalCents: bigint('retention_total_cents', { mode: 'number' }).notNull().default(0),
    netAmountCents: bigint('net_amount_cents', { mode: 'number' }).notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    description: text('description'),
    docNumber: text('doc_number'),
    docKey: text('doc_key'),
    /** Sprint 15b — FK pra nfe_received (ADR 0056). NULL no MVP. */
    nfeReceivedId: uuid('nfe_received_id'),
    noInvoice: boolean('no_invoice').notNull().default(false),
    status: apStatusEnum('status').notNull().default('draft'),
    approvalTrace: jsonb('approval_trace').notNull().default(sql`'[]'::jsonb`),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidAmountCents: bigint('paid_amount_cents', { mode: 'number' }),
    paymentMethod: apPaymentMethodEnum('payment_method'),
    asaasTransferId: text('asaas_transfer_id'),
    attachmentStoragePath: text('attachment_storage_path'),
    source: apSourceEnum('source').notNull().default('manual'),
    sourceMetadata: jsonb('source_metadata'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_payable_tenant_status_idx').on(t.tenantId, t.status),
    index('accounts_payable_tenant_due_idx').on(t.tenantId, t.dueDate),
    index('accounts_payable_supplier_idx').on(t.supplierId),
    index('accounts_payable_chart_idx').on(t.chartAccountId),
    index('accounts_payable_company_idx').on(t.companyId, t.dueDate),
    uniqueIndex('accounts_payable_doc_key_uq').on(t.docKey).where(sql`doc_key IS NOT NULL`),
    check('accounts_payable_amount_positive', sql`${t.amountCents} > 0`),
    check(
      'accounts_payable_net_consistent',
      sql`${t.netAmountCents} = ${t.amountCents} - ${t.retentionTotalCents}`,
    ),
    check('accounts_payable_retention_non_negative', sql`${t.retentionTotalCents} >= 0`),
    check('accounts_payable_due_after_issue', sql`${t.dueDate} >= ${t.issueDate}`),
  ],
)

// ─── accounts_receivable (AR avulso) ────────────────────────────────────
/**
 * AR avulso = recebimento não vinculado a contrato (aluguel recebido,
 * venda esporádica, reembolso de fornecedor). Para mensalidade de contrato,
 * usar `invoices` (Sprint 04).
 *
 * `invoice_id nullable`: link opcional com Sprint 04 `invoices` quando
 * AR é cobrança via Asaas — permite mesmo dashboard.
 *
 * `payer_person_id`: pagador (PF ou PJ via persons).
 */
export const accountsReceivable = pgTable(
  'accounts_receivable',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    payerPersonId: uuid('payer_person_id').references(() => persons.id, {
      onDelete: 'set null',
    }),
    chartAccountId: uuid('chart_account_id')
      .notNull()
      .references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    description: text('description'),
    docNumber: text('doc_number'),
    /** Sprint 04 invoices.id quando AR linka com contrato */
    invoiceId: uuid('invoice_id'),
    asaasChargeId: text('asaas_charge_id'),
    externalUrl: text('external_url'),
    status: arStatusEnum('status').notNull().default('draft'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    receivedAmountCents: bigint('received_amount_cents', { mode: 'number' }),
    attachmentStoragePath: text('attachment_storage_path'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_receivable_tenant_status_idx').on(t.tenantId, t.status),
    index('accounts_receivable_tenant_due_idx').on(t.tenantId, t.dueDate),
    index('accounts_receivable_chart_idx').on(t.chartAccountId),
    index('accounts_receivable_payer_idx').on(t.payerPersonId),
    check('accounts_receivable_amount_positive', sql`${t.amountCents} > 0`),
    check('accounts_receivable_due_after_issue', sql`${t.dueDate} >= ${t.issueDate}`),
  ],
)

// ─── ap_ar_payments (pagamentos parciais) ───────────────────────────────
/**
 * 1 AP/AR pode ter múltiplos pagamentos parciais. Sum(amount_cents) deve
 * bater com AP.net_amount_cents (ou AR.amount_cents) pra status='paid'.
 *
 * `source_type` discrimina FK lógica: 'ap' → accounts_payable.id; 'ar' →
 * accounts_receivable.id.
 *
 * **Append-only** via ausência de UPDATE/DELETE policy. Correções via
 * estorno (criar pagamento negativo).
 */
export const apArPayments = pgTable(
  'ap_ar_payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    sourceType: text('source_type').notNull(), // 'ap' | 'ar'
    sourceId: uuid('source_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    method: apPaymentMethodEnum('method').notNull(),
    reference: text('reference'), // ID externo (transação Asaas, comprovante)
    notes: text('notes'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ap_ar_payments_source_idx').on(t.sourceType, t.sourceId),
    index('ap_ar_payments_tenant_paid_idx').on(t.tenantId, t.paidAt),
    check('ap_ar_payments_source_type_valid', sql`${t.sourceType} IN ('ap', 'ar')`),
  ],
)
