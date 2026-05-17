/**
 * Rateio entre filiais + Lançamentos Intercompany — Sprint 16 Faixa A (ADR 0036).
 *
 * **Rateio (uma conta paga por uma company, custos distribuídos a várias):**
 *   - `allocation_rules` — DSL declarativa (fixed/proportional/per_unit/by_revenue/by_headcount/custom)
 *   - `ap_allocations` — entries gerados ao submeter AP com flag rateado;
 *     PK `(ap_id, company_id)`; soma deve igualar `accounts_payable.net_amount_cents`
 *     (validado via trigger Sprint 16+).
 *
 * **Intercompany (IC) — lançamento espelhado entre 2 companies:**
 *   - `intercompany_entries` — `from_company` paga/movimenta para `to_company`;
 *     `counter_entry_id nullable` espelha (entry A linka entry B em pares);
 *     `kind` enum cobre payment/transfer/service/goods/adjustment;
 *     `requires_nfe_transfer bool` ativado por trigger quando kind='goods' e
 *     CNPJs distintos (Sprint 36 emite NF-e via Focus — ADR 0059).
 *
 * **Regra 25 — `topology=franchise` bloqueia rateio + IC:**
 *   Check constraint impede insert se `tenant.topology != 'owned'`. Franquia opera
 *   N CNPJs distintos sem vínculo financeiro corporativo — rateio violaria CTB ou
 *   exigiria contrato comercial entre franqueado e franqueador (fora de escopo MVP).
 *   Enforcement via trigger BEFORE INSERT que lê `tenants.topology`.
 *
 * **Snapshot do KPI no momento do lançamento:**
 *   Rule kind='by_revenue' calcula % no instante do submitForApproval — não há
 *   recálculo retroativo se faturamento mudar depois. `ap_allocations.percent_applied`
 *   é frozen. Sprint 16+ pode adicionar recálculo opcional.
 *
 * **Cap de 20 companies por rule** — `distribution jsonb` limitado pra evitar payload
 *   absurdo; tenant com >20 filiais cria múltiplas rules por agrupamento.
 *
 * @volume_estimate_yearly: 500000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  numeric,
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

export const allocationRuleKindEnum = pgEnum('allocation_rule_kind', [
  'fixed', // % fixo por company: [{companyId, percent: 40}, ...]
  'proportional', // % por uma coluna numérica explicita: weights[]
  'per_unit', // distribui igualmente por number_of_units de cada company
  'by_revenue', // proporcional ao revenue do mês anterior (snapshot)
  'by_headcount', // proporcional ao headcount (snapshot)
  'custom', // jsonb livre — operador define manualmente cada %
])

export const intercompanyKindEnum = pgEnum('intercompany_kind', [
  'payment', // matriz pagou fornecedor pela filial
  'transfer', // dinheiro/ativo entre contas bancárias do mesmo grupo
  'service', // empresa A prestou serviço para empresa B
  'goods', // empresa A enviou bens físicos para empresa B (gatilho NF-e transferência)
  'adjustment', // ajuste contábil (zera saldo, conciliação)
])

// ─── allocation_rules ────────────────────────────────────────────────────
/**
 * `distribution jsonb` formato depende de `kind`:
 *
 * **fixed**:
 * ```json
 * [
 *   { "companyId": "uuid-1", "percent": 40 },
 *   { "companyId": "uuid-2", "percent": 30 },
 *   { "companyId": "uuid-3", "percent": 30 }
 * ]
 * ```
 * Soma dos percent deve ser 100 (validado pela calculator).
 *
 * **proportional/by_revenue/by_headcount**:
 * ```json
 * [
 *   { "companyId": "uuid-1", "weight": 1 },
 *   { "companyId": "uuid-2", "weight": 1 }
 * ]
 * ```
 * (apenas listagem; weights/% calculados em runtime via snapshot)
 *
 * **per_unit**: lista de companies elegíveis; calculator divide pela contagem de
 * units de cada uma.
 *
 * **custom**: jsonb totalmente livre — operador admin desenhou rule específica.
 */
export const allocationRules = pgTable(
  'allocation_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    kind: allocationRuleKindEnum('kind').notNull(),
    distribution: jsonb('distribution').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('allocation_rules_tenant_idx').on(t.tenantId).where(sql`active = true`),
    uniqueIndex('allocation_rules_tenant_name_uq').on(t.tenantId, t.name),
  ],
)

// ─── ap_allocations ──────────────────────────────────────────────────────
/**
 * Gerado ao submeter AP com `allocation_rule_id != NULL`. Cada AP rateada
 * tem N rows nessa tabela (uma por company beneficiária).
 *
 * Sum(amount_cents) deve = accounts_payable.net_amount_cents (validado por
 * trigger BEFORE COMMIT — Sprint 16+).
 *
 * `percent_applied numeric(7,4)` armazena o % efetivamente aplicado (snapshot
 * frozen para rule by_revenue/by_headcount). Total deve ser ~100 (com ε
 * de arredondamento — calculator distribui resto pra primeira company).
 *
 * **Append-only** — sem UPDATE/DELETE policy. Correção via cancelar AP e
 * recriar.
 */
export const apAllocations = pgTable(
  'ap_allocations',
  {
    apId: uuid('ap_id')
      .notNull()
      .references(() => accountsPayable.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    percentApplied: numeric('percent_applied', { precision: 7, scale: 4 }).notNull(),
    ruleId: uuid('rule_id').references(() => allocationRules.id),
    ruleKind: allocationRuleKindEnum('rule_kind'),
    /** Snapshot do contexto usado no cálculo (revenue/headcount no momento). */
    contextSnapshot: jsonb('context_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ap_allocations_pk').on(t.apId, t.companyId),
    index('ap_allocations_tenant_idx').on(t.tenantId),
    index('ap_allocations_company_idx').on(t.companyId),
    check('ap_allocations_amount_positive', sql`${t.amountCents} > 0`),
    check(
      'ap_allocations_percent_in_range',
      sql`${t.percentApplied} >= 0 AND ${t.percentApplied} <= 100`,
    ),
  ],
)

// ─── intercompany_entries ────────────────────────────────────────────────
/**
 * Lançamento que cruza 2 companies do mesmo tenant. Modelo espelhado:
 * entry A em `from_company` linka via `counter_entry_id` com entry B em
 * `to_company`. Se A não tem espelho (NULL), é lançamento "unilateral" que
 * vai gerar contrapartida na próxima rodada do job.
 *
 * `kind='goods'` + CNPJs distintos (from.person_id ≠ to.person_id) ativa
 * `requires_nfe_transfer=true` via trigger Sprint 16+; UI mostra alerta;
 * Sprint 36 oferece "Emitir NF-e transferência via Focus" preenchendo
 * `nfe_transfer_emission_id`.
 *
 * `settled_at` + `settlement_method` registra liquidação (transferência
 * bancária real, ou ajuste virtual zerando saldo). Saldo IC = sum(entries
 * pendentes) entre par from→to.
 *
 * **Regra 25**: trigger BEFORE INSERT lê `tenants.topology` e bloqueia se
 * != 'owned'. Franquia opera CNPJs sem vínculo financeiro corporativo.
 */
export const intercompanyEntries = pgTable(
  'intercompany_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    fromCompanyId: uuid('from_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    toCompanyId: uuid('to_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    kind: intercompanyKindEnum('kind').notNull(),
    referenceApId: uuid('reference_ap_id').references(() => accountsPayable.id),
    referenceArId: uuid('reference_ar_id').references(() => accountsReceivable.id),
    counterEntryId: uuid('counter_entry_id'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settlementMethod: text('settlement_method'),
    notes: text('notes'),
    requiresNfeTransfer: boolean('requires_nfe_transfer').notNull().default(false),
    /** Sprint 36 ADR 0059 — FK pra fiscal_emissions quando NF-e foi emitida. */
    nfeTransferEmissionId: uuid('nfe_transfer_emission_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ic_entries_tenant_idx').on(t.tenantId),
    index('ic_entries_from_idx').on(t.fromCompanyId, t.createdAt),
    index('ic_entries_to_idx').on(t.toCompanyId, t.createdAt),
    index('ic_entries_pair_unsettled_idx')
      .on(t.tenantId, t.fromCompanyId, t.toCompanyId)
      .where(sql`settled_at IS NULL`),
    check('ic_entries_amount_positive', sql`${t.amountCents} > 0`),
    check('ic_entries_distinct_companies', sql`${t.fromCompanyId} <> ${t.toCompanyId}`),
  ],
)
