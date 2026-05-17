/**
 * Adquirência (maquininhas) — Sprint 18 Faixa A (ADR 0039 esperado).
 *
 * Provider abstrato (Cielo / Stone / Rede / GetNet / PagSeguro) + sync diário
 * de vendas + conciliação com `bank_transactions` (Sprint 17) + antecipação
 * de recebíveis + split em franquias (consome `franchise_agreements` Sprint
 * 01b — não modelado aqui; aplicado em runtime via Server Action).
 *
 * 4 tabelas:
 *   - acquirer_connections — credenciais cifradas + merchant_id + sandbox
 *   - acquirer_sales — venda capturada (NSU) com taxa + parcelas + bandeira
 *   - anticipations — solicitação de antecipação de recebíveis
 *   - acquirer_reconciliation_rules — regras pra match venda↔bank_transaction
 *
 * **Particionamento `acquirer_sales`** (regra 34 + ADR 0072):
 *   - Estimativa: tenant médio com 1 maquininha + 1k vendas/mês = 12k/ano;
 *     1k tenants = 12M+ linhas/ano (3º maior volume do MVP depois de
 *     bank_transactions e audit_log). PARTITION BY RANGE (captured_at) por
 *     trimestre via migration manual após criação da tabela base.
 *   - Retenção 5a hot + cold storage Parquet zstd após 2a (alinhado a
 *     compliance fiscal — receita bruta de venda física).
 *
 * **Criptografia credentials** (regra 35 + ADR 0073 camada 4):
 *   - Envelope encryption AES-256-GCM com KEK por company (mesma estrutura
 *     que `openfinance_connections.access_token_encrypted`).
 *   - `credentials_encrypted jsonb` cifrado em coluna `text` (base64 do
 *     envelope) — variar por provider (Cielo merchantId+merchantKey, Stone
 *     stoneCode+apiKey, etc).
 *
 * **Reconciliação venda↔banco** (regra negocial):
 *   - Quando `acquirer_sales.actual_settlement_date` chega + valor bate com
 *     `bank_transactions.amount_cents` positivo em D+settlement, marca
 *     `reconciled_with_bank_tx_id`. Job daily verifica + sugere match.
 *   - Alerta divergência: venda com `expected_settlement_date < today - 2d`
 *     sem `actual_settlement_date` dispara `acquirer.divergence_detected`.
 *
 * @volume_estimate_yearly: 12000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { bankTransactions } from './bancos'
import { companies, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const acquirerProviderEnum = pgEnum('acquirer_provider', [
  'cielo',
  'stone',
  'rede',
  'getnet',
  'pagseguro',
  'mock', // adapter de teste/sandbox
])

export const acquirerConnectionStatusEnum = pgEnum('acquirer_connection_status', [
  'pending', // criada mas ainda não testada
  'active',
  'error',
  'revoked',
])

export const acquirerSaleStatusEnum = pgEnum('acquirer_sale_status', [
  'captured', // venda capturada na maquininha
  'anticipated', // antecipada antes do settlement original
  'settled', // já caiu no banco (D+settlement)
  'chargeback', // contestada/estornada
  'cancelled', // cancelada antes de settle
])

export const cardKindEnum = pgEnum('acquirer_card_kind', [
  'credit',
  'debit',
  'voucher', // VR/VA/etc
  'pix', // PIX via maquininha
  'other',
])

export const anticipationStatusEnum = pgEnum('anticipation_status', [
  'requested', // solicitada
  'approved', // aprovada pelo provider
  'credited', // valor creditado no banco
  'rejected', // recusada
  'cancelled', // cancelada antes de approve
])

export const acquirerReconcileActionEnum = pgEnum('acquirer_reconcile_action', [
  'auto_match_bank', // tenta match com bank_transactions
  'flag_for_review', // só sinaliza
])

// ─── acquirer_connections ────────────────────────────────────────────────

export const acquirerConnections = pgTable(
  'acquirer_connections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    provider: acquirerProviderEnum('provider').notNull(),
    /** ID do merchant/estabelecimento no provider (PV Cielo, stoneCode, etc). */
    merchantId: text('merchant_id').notNull(),
    /** Credenciais cifradas AES-256-GCM (envelope encryption — ADR 0073). Formato varia por provider. */
    credentialsEncrypted: text('credentials_encrypted'),
    /** Nickname amigável (ex: "Stone Matriz", "Cielo Filial 1"). */
    nickname: text('nickname'),
    /** Conta bancária default pra crediar settlement (link com Sprint 17). */
    settlementBankAccountId: uuid('settlement_bank_account_id'),
    /** Modo sandbox do provider — testes não atingem produção. */
    sandbox: boolean('sandbox').notNull().default(false),
    status: acquirerConnectionStatusEnum('status').notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    metadata: jsonb('metadata'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('acq_conn_tenant_company_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`active = true`),
    index('acq_conn_status_idx').on(t.status).where(sql`status IN ('active', 'error')`),
    uniqueIndex('acq_conn_merchant_uq').on(t.provider, t.merchantId),
  ],
)

// ─── acquirer_sales ──────────────────────────────────────────────────────
/**
 * Venda capturada na maquininha. `external_id` é NSU (Nº Sequencial Único) do
 * provider. Unique `(connection_id, external_id)` evita reimport.
 *
 * **Valores em centavos:**
 *   - `grossAmountCents` — bruto cobrado do cartão
 *   - `feeCents` — taxa MDR cobrada pelo provider
 *   - `netAmountCents` — líquido a receber = gross - fee
 *   - `anticipatedAmountCents` — quando antecipada, valor efetivamente creditado
 *     (gross - fee - taxa de antecipação). NULL quando não antecipada.
 *
 * **Particionamento por trimestre** (ADR 0072 + regra 34): migration manual
 * declara `PARTITION BY RANGE (captured_at)` após criação da tabela base.
 */
export const acquirerSales = pgTable(
  'acquirer_sales',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => acquirerConnections.id, { onDelete: 'restrict' }),
    /** NSU ou equivalente — id estável do provider. */
    externalId: text('external_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    grossAmountCents: bigint('gross_amount_cents', { mode: 'number' }).notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull().default(0),
    netAmountCents: bigint('net_amount_cents', { mode: 'number' }).notNull(),
    /** Quando antecipada: valor creditado (gross - fee - fee_anticipation). */
    anticipatedAmountCents: bigint('anticipated_amount_cents', { mode: 'number' }),
    /** Bandeira: visa/master/elo/amex/hipercard/etc */
    cardBrand: text('card_brand'),
    cardKind: cardKindEnum('card_kind').notNull().default('credit'),
    /** 1 = à vista, 2-12 = parcelado */
    installments: integer('installments').notNull().default(1),
    /** Data prevista de crédito (D+1 débito, D+30 crédito típico, etc). */
    expectedSettlementDate: text('expected_settlement_date').notNull(), // YYYY-MM-DD
    /** Data real de crédito (preenchida quando settle). */
    actualSettlementDate: text('actual_settlement_date'), // YYYY-MM-DD
    /** Link com a bank_transaction quando conciliada. */
    reconciledWithBankTxId: uuid('reconciled_with_bank_tx_id').references(
      () => bankTransactions.id,
      { onDelete: 'set null' },
    ),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledByUserId: uuid('reconciled_by_user_id').references(() => users.id),
    status: acquirerSaleStatusEnum('status').notNull().default('captured'),
    /** Payload bruto do provider pra auditoria + reprocessamento. */
    rawPayload: jsonb('raw_payload'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('acq_sales_external_uq').on(t.connectionId, t.externalId),
    index('acq_sales_company_captured_idx').on(t.companyId, t.capturedAt),
    index('acq_sales_settlement_idx')
      .on(t.expectedSettlementDate)
      .where(sql`actual_settlement_date IS NULL`),
    index('acq_sales_tenant_unreconciled_idx')
      .on(t.tenantId, t.capturedAt)
      .where(sql`reconciled_at IS NULL AND status IN ('settled', 'anticipated')`),
    check('acq_sales_net_consistent', sql`net_amount_cents = gross_amount_cents - fee_cents`),
    check('acq_sales_installments_valid', sql`installments >= 1 AND installments <= 24`),
    check('acq_sales_amounts_positive', sql`gross_amount_cents > 0`),
  ],
)

// ─── anticipations ───────────────────────────────────────────────────────
/**
 * Solicitação de antecipação de recebíveis. Provider aplica desconto sobre o
 * `originalAmountCents` (valor original a receber) e retorna `anticipatedAmountCents`
 * efetivamente creditado.
 *
 * `salesIds` array de UUIDs das `acquirer_sales` antecipadas. Quando aprovada,
 * marca cada sale com `status='anticipated'` + `anticipatedAmountCents` proporcional.
 */
export const anticipations = pgTable(
  'anticipations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => acquirerConnections.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** UUIDs das acquirer_sales incluídas. */
    salesIds: uuid('sales_ids').array().notNull(),
    originalAmountCents: bigint('original_amount_cents', { mode: 'number' }).notNull(),
    anticipatedAmountCents: bigint('anticipated_amount_cents', { mode: 'number' }),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull().default(0),
    /** Taxa de antecipação efetiva (% a.m. equivalente) — provider retorna. */
    effectiveRatePct: text('effective_rate_pct'), // numeric like "1.99"
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    creditedAt: timestamp('credited_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    status: anticipationStatusEnum('status').notNull().default('requested'),
    /** ID externo no provider pra tracking. */
    externalId: text('external_id'),
    rawPayload: jsonb('raw_payload'),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
  },
  (t) => [
    index('antic_tenant_status_idx').on(t.tenantId, t.status),
    index('antic_connection_idx').on(t.connectionId),
    check('antic_amounts_positive', sql`original_amount_cents > 0`),
  ],
)

// ─── acquirer_reconciliation_rules ───────────────────────────────────────
/**
 * Regras de auto-match venda↔bank_transaction. Análogo a `reconciliation_rules`
 * (Sprint 17) mas focado no mundo maquininha.
 *
 * `condition jsonb` formato:
 * ```json
 * {
 *   "providerEquals": "stone",
 *   "cardBrandEquals": "visa",
 *   "amountMinCents": 1000,
 *   "amountMaxCents": 500000,
 *   "daysAfterSettlementMax": 2
 * }
 * ```
 */
export const acquirerReconciliationRules = pgTable(
  'acquirer_reconciliation_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    condition: jsonb('condition').notNull(),
    action: acquirerReconcileActionEnum('action').notNull().default('auto_match_bank'),
    /** Conta bancária target — quando NULL usa `acquirer_connections.settlementBankAccountId`. */
    targetBankAccountId: uuid('target_bank_account_id'),
    priority: integer('priority').notNull().default(100),
    active: boolean('active').notNull().default(true),
    hitsCount: integer('hits_count').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('acq_rules_tenant_priority_idx')
      .on(t.tenantId, t.priority)
      .where(sql`active = true`),
    uniqueIndex('acq_rules_tenant_name_uq').on(t.tenantId, t.name),
  ],
)
