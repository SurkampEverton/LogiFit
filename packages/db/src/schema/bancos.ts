/**
 * Bancos + Open Finance + Conciliação — Sprint 17 Faixa A (ADRs 0037 + 0038).
 *
 * 5 tabelas:
 *   - bank_accounts — conta bancária por company
 *   - openfinance_connections — OAuth tokens criptografados por company
 *   - bank_transactions — extrato (particionado por trimestre via comentário; ADR 0072)
 *   - reconciliation_rules — DSL declarativa pra match automático
 *   - nfe_sefaz_cursors — cursor de sincronização SEFAZ por company+provider
 *
 * **`bank_transactions` particionamento** (regra 34 + ADR 0072):
 *   - Estimativa 1k tenants × 500 tx/mês × 12 = 6M+ linhas/ano
 *   - PARTITION BY RANGE (posted_at) trimestral
 *   - Migration manual após criar tabela base (Drizzle não emite PARTITION nativo)
 *   - Retenção 5a hot + cold storage Parquet zstd após 2a
 *
 * **Criptografia tokens/credentials** (regra 35 + ADR 0073 camada 4):
 *   - Envelope encryption AES-256-GCM com KEK por company
 *   - `access_token_encrypted bytea` (não texto) — DPAPI-style
 *   - Senha pra master key vive em env LogiFit; chave por company em `master_key_certificates`
 *
 * @volume_estimate_yearly: 6000000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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
import { accountsPayable, accountsReceivable } from './erp-financeiro'
import { companies, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const bankAccountKindEnum = pgEnum('bank_account_kind', [
  'checking', // conta corrente PF
  'savings', // poupança
  'business', // conta corrente PJ
  'cashbox', // caixa físico
])

export const openfinanceProviderEnum = pgEnum('openfinance_provider', [
  'pluggy',
  'belvo',
  'direct', // integração direta com banco (não MVP)
])

export const openfinanceStatusEnum = pgEnum('openfinance_connection_status', [
  'pending',
  'active',
  'error',
  'expired',
  'revoked',
])

export const reconciliationActionEnum = pgEnum('reconciliation_action', [
  'auto_match_ap', // tenta match com AP por critério
  'auto_match_ar', // tenta match com AR
  'auto_create_entry', // cria custo via cost_entries
  'flag_for_review', // só sinaliza pra operador
])

export const certificateKindEnum = pgEnum('certificate_kind', [
  'a1', // .pfx/.p12 — usado em servidor
])

// ─── bank_accounts ───────────────────────────────────────────────────────

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    bankCode: text('bank_code').notNull(),
    bankName: text('bank_name').notNull(),
    agency: text('agency'),
    accountNumber: text('account_number').notNull(),
    accountDigit: text('account_digit'),
    kind: bankAccountKindEnum('kind').notNull().default('business'),
    /** Saldo inicial registrado pelo operador (centavos). */
    openingBalanceCents: bigint('opening_balance_cents', { mode: 'number' }).notNull().default(0),
    openingBalanceAt: timestamp('opening_balance_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Saldo cacheado — atualizado por sync ou conciliação. */
    currentBalanceCents: bigint('current_balance_cents', { mode: 'number' }).notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Sprint 17+: link com OF connection se vier de Open Finance */
    openfinanceConnectionId: uuid('openfinance_connection_id'),
    /** Nickname amigável (ex: "Bradesco Matriz CC", "Caixa Filial 1") */
    nickname: text('nickname'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bank_accounts_tenant_company_idx').on(t.tenantId, t.companyId).where(sql`active = true`),
    uniqueIndex('bank_accounts_unique_per_company_uq').on(
      t.companyId,
      t.bankCode,
      t.agency,
      t.accountNumber,
    ),
  ],
)

// ─── openfinance_connections ─────────────────────────────────────────────

export const openfinanceConnections = pgTable(
  'openfinance_connections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    provider: openfinanceProviderEnum('provider').notNull(),
    /** ID externo no provider (item_id da Pluggy etc) */
    externalConnectionId: text('external_connection_id'),
    /** Token criptografado (envelope encryption ADR 0073) */
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    status: openfinanceStatusEnum('status').notNull().default('pending'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('of_conn_tenant_company_idx').on(t.tenantId, t.companyId),
    index('of_conn_status_idx').on(t.status).where(sql`status IN ('active', 'error')`),
  ],
)

// ─── bank_transactions ───────────────────────────────────────────────────
/**
 * Extrato bancário. `amount_cents` negativo = saída (débito), positivo =
 * entrada (crédito).
 *
 * `external_id` é id do provider (OF). NULL = importação OFX/manual.
 * Unique global `(provider, external_id)` quando NOT NULL evita reimport.
 *
 * **Particionamento por trimestre** (ADR 0072 + regra 34): migration manual
 * declara `PARTITION BY RANGE (posted_at)` após criação da tabela base.
 */
export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    externalId: text('external_id'),
    /** Quando a transação aconteceu (data do extrato). */
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    /** Negativo = saída, positivo = entrada */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    description: text('description').notNull(),
    /** memo/info adicional do banco */
    memo: text('memo'),
    /** ofx/openfinance/manual */
    source: text('source').notNull().default('manual'),
    rawPayload: jsonb('raw_payload'),
    /** Conciliação ↓ */
    reconciledWithApId: uuid('reconciled_with_ap_id').references(() => accountsPayable.id, {
      onDelete: 'set null',
    }),
    reconciledWithArId: uuid('reconciled_with_ar_id').references(() => accountsReceivable.id, {
      onDelete: 'set null',
    }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledByUserId: uuid('reconciled_by_user_id').references(() => users.id),
    reconciledByRuleId: uuid('reconciled_by_rule_id'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bank_tx_account_posted_idx').on(t.bankAccountId, t.postedAt),
    index('bank_tx_tenant_unreconciled_idx')
      .on(t.tenantId, t.postedAt)
      .where(sql`reconciled_at IS NULL`),
    uniqueIndex('bank_tx_external_uq')
      .on(t.bankAccountId, t.externalId)
      .where(sql`external_id IS NOT NULL`),
  ],
)

// ─── reconciliation_rules ────────────────────────────────────────────────
/**
 * `condition jsonb` formato:
 * ```json
 * {
 *   "descriptionContains": "aluguel",
 *   "amountMinCents": 350000,
 *   "amountMaxCents": 450000,
 *   "amountSign": "negative" | "positive"
 * }
 * ```
 *
 * Motor `applyRules(tx, rules[])` retorna 1ª rule cuja condition match
 * (ordenado por `priority asc`).
 */
export const reconciliationRules = pgTable(
  'reconciliation_rules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    condition: jsonb('condition').notNull(),
    action: reconciliationActionEnum('action').notNull(),
    /** Alvos opcionais quando action='auto_match_ap'/'auto_create_entry' */
    targetSupplierId: uuid('target_supplier_id'),
    targetChartAccountId: uuid('target_chart_account_id'),
    targetCompanyId: uuid('target_company_id'),
    priority: integer('priority').notNull().default(100),
    active: boolean('active').notNull().default(true),
    /** Hits acumulados — quantas vezes a rule já matchou */
    hitsCount: integer('hits_count').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rec_rules_tenant_priority_idx').on(t.tenantId, t.priority).where(sql`active = true`),
    uniqueIndex('rec_rules_tenant_name_uq').on(t.tenantId, t.name),
  ],
)
