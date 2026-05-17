'use server'

/**
 * Server Actions Adquirência — Sprint 18 Faixa B.2 (ADR 0039 esperado).
 *
 * MVP (provider mock + adapters reais stub até Sprint 18b):
 *   - connectAcquirer / testAcquirerConnection
 *   - listAcquirerConnections / archiveAcquirerConnection
 *   - syncAcquirerSales(connectionId, from, to) — usa adapter (mock por default)
 *   - listAcquirerSales (filtros connection/period/status/reconciled)
 *   - requestAnticipationAction(connectionId, saleIds[]) — usa adapter
 *   - reconcileSale(saleId, bankTxId) — match manual
 *   - suggestSettlementMatchesAction(saleId) — top-3 bank_transactions candidatas
 *   - createAcquirerReconciliationRule / listAcquirerReconciliationRules / archive
 *   - getUnifiedRevenue(companyId, periodFrom, periodTo) — dashboard receita
 *     online (invoices Sprint 04) + presencial (acquirer_sales)
 *
 * Credentials cifradas → Sprint 18b com `envelopeEncrypt()` real;
 * por ora aceita strings em claro com warning (sandbox/mock).
 */

import {
  computeSaleCost,
  feeRateFor,
  getAdapter,
  quoteAnticipation,
  suggestSettlementMatches,
  type AcquirerProvider as AcquirerProviderKey,
  type SaleInput,
  type BankTxInput,
} from '@repo/db/adquirencia'
import {
  acquirerConnections,
  acquirerReconciliationRules,
  acquirerSales,
  anticipations,
  bankAccounts,
  bankTransactions,
  invoices,
} from '@repo/db/schema'
import { db } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const ProviderKeyEnum = z.enum(['cielo', 'stone', 'rede', 'getnet', 'pagseguro', 'mock'])

const ConnectAcquirerInputSchema = z.object({
  companyId: z.string().uuid(),
  provider: ProviderKeyEnum,
  merchantId: z.string().min(2).max(200),
  /** JSON com credentials por provider. Em sandbox/mock aceita objeto simples. */
  credentials: z.record(z.string(), z.string()).optional(),
  nickname: z.string().max(120).optional().nullable(),
  settlementBankAccountId: z.string().uuid().optional().nullable(),
  sandbox: z.boolean().default(false),
})

const TestAcquirerConnectionInputSchema = z.object({
  connectionId: z.string().uuid(),
})

const ListAcquirerConnectionsInputSchema = z.object({
  includeArchived: z.boolean().optional(),
  companyId: z.string().uuid().optional(),
})

const ArchiveAcquirerConnectionInputSchema = z.object({
  connectionId: z.string().uuid(),
})

const SyncAcquirerSalesInputSchema = z.object({
  connectionId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const ListAcquirerSalesInputSchema = z.object({
  connectionId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: z
    .enum(['captured', 'anticipated', 'settled', 'chargeback', 'cancelled', 'all'])
    .default('all'),
  reconciled: z.enum(['yes', 'no', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

const RequestAnticipationInputSchema = z.object({
  connectionId: z.string().uuid(),
  saleIds: z.array(z.string().uuid()).min(1).max(500),
})

const ReconcileSaleInputSchema = z.object({
  saleId: z.string().uuid(),
  bankTxId: z.string().uuid(),
})

const SuggestSettlementMatchesInputSchema = z.object({
  saleId: z.string().uuid(),
  maxResults: z.number().int().min(1).max(10).default(3),
})

const CreateAcquirerRuleInputSchema = z.object({
  name: z.string().min(2).max(120),
  condition: z.record(z.string(), z.unknown()),
  action: z.enum(['auto_match_bank', 'flag_for_review']).default('auto_match_bank'),
  targetBankAccountId: z.string().uuid().optional().nullable(),
  priority: z.number().int().min(1).max(1000).default(100),
})

const ArchiveAcquirerRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
})

const GetUnifiedRevenueInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// ─── connectAcquirer ─────────────────────────────────────────────────────

export const connectAcquirer = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.connect', resourceType: 'acquirer_connections' },
  async (
    input: z.infer<typeof ConnectAcquirerInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ConnectAcquirerInputSchema.parse(input)

    // ⚠️ Sprint 18b implementa envelope encryption real (regra 35 + ADR 0073).
    // Por ora persiste em claro com flag mock/sandbox. **NUNCA** subir credenciais
    // de prod em modo MVP.
    if (parsed.provider !== 'mock' && !parsed.sandbox) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message:
          'Provider real exige credentials cifradas via envelope encryption (ADR 0073 — Sprint 18b POC). Use sandbox=true ou provider=mock no MVP.',
        request_id: '',
      })
    }

    const credentialsBlob = parsed.credentials
      ? JSON.stringify({ ...parsed.credentials, merchantId: parsed.merchantId })
      : null

    try {
      const [row] = await db
        .insert(acquirerConnections)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: parsed.companyId,
          provider: parsed.provider,
          merchantId: parsed.merchantId,
          credentialsEncrypted: credentialsBlob,
          nickname: parsed.nickname ?? null,
          settlementBankAccountId: parsed.settlementBankAccountId ?? null,
          sandbox: parsed.sandbox,
          status: 'pending',
          createdByUserId: session.user.id,
        })
        .returning({ id: acquirerConnections.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar conexão',
          request_id: '',
        })
      setAuditResource(row.id, { provider: parsed.provider, sandbox: parsed.sandbox })
      return { id: row.id }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Já existe conexão ${parsed.provider} com merchantId ${parsed.merchantId} cadastrada na plataforma`,
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── testAcquirerConnection ──────────────────────────────────────────────

export const testAcquirerConnection = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.test', resourceType: 'acquirer_connections' },
  async (
    input: z.infer<typeof TestAcquirerConnectionInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = TestAcquirerConnectionInputSchema.parse(input)
    const [conn] = await db
      .select()
      .from(acquirerConnections)
      .where(
        and(
          eq(acquirerConnections.id, parsed.connectionId),
          eq(acquirerConnections.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!conn)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Conexão não encontrada',
        request_id: '',
      })

    const adapter = getAdapter(conn.provider as AcquirerProviderKey)
    const credentials = conn.credentialsEncrypted ? JSON.parse(conn.credentialsEncrypted) : {}
    const result = await adapter.testConnection(credentials, conn.sandbox)

    await db
      .update(acquirerConnections)
      .set({
        status: result.ok ? 'active' : 'error',
        lastSyncError: result.ok ? null : result.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(acquirerConnections.id, conn.id))

    setAuditResource(conn.id, { ok: result.ok })
    return result
  },
)

// ─── listAcquirerConnections ─────────────────────────────────────────────

export const listAcquirerConnections = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.list' },
  async (input: z.infer<typeof ListAcquirerConnectionsInputSchema> | undefined, { session }) => {
    const parsed = ListAcquirerConnectionsInputSchema.parse(input ?? {})
    const where = [eq(acquirerConnections.tenantId, session.logifit.tenantId)]
    if (!parsed.includeArchived) where.push(isNull(acquirerConnections.archivedAt))
    if (parsed.companyId) where.push(eq(acquirerConnections.companyId, parsed.companyId))
    const rows = await db
      .select({
        id: acquirerConnections.id,
        companyId: acquirerConnections.companyId,
        provider: acquirerConnections.provider,
        merchantId: acquirerConnections.merchantId,
        nickname: acquirerConnections.nickname,
        sandbox: acquirerConnections.sandbox,
        status: acquirerConnections.status,
        lastSyncedAt: acquirerConnections.lastSyncedAt,
        lastSyncError: acquirerConnections.lastSyncError,
        settlementBankAccountId: acquirerConnections.settlementBankAccountId,
        active: acquirerConnections.active,
        archivedAt: acquirerConnections.archivedAt,
      })
      .from(acquirerConnections)
      .where(and(...where))
      .orderBy(asc(acquirerConnections.provider))
    return { connections: rows }
  },
)

// ─── archiveAcquirerConnection ───────────────────────────────────────────

export const archiveAcquirerConnection = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.archive', resourceType: 'acquirer_connections' },
  async (
    input: z.infer<typeof ArchiveAcquirerConnectionInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ArchiveAcquirerConnectionInputSchema.parse(input)
    const [row] = await db
      .update(acquirerConnections)
      .set({ archivedAt: new Date(), active: false, status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(acquirerConnections.id, parsed.connectionId),
          eq(acquirerConnections.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: acquirerConnections.id })
    if (!row)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Conexão não encontrada', request_id: '' })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── syncAcquirerSales ───────────────────────────────────────────────────

export const syncAcquirerSales = wrapServerAction(
  {
    module: 'financeiro',
    action: 'acquirer.sync_sales',
    resourceType: 'acquirer_sales',
  },
  async (
    input: z.infer<typeof SyncAcquirerSalesInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = SyncAcquirerSalesInputSchema.parse(input)
    const [conn] = await db
      .select()
      .from(acquirerConnections)
      .where(
        and(
          eq(acquirerConnections.id, parsed.connectionId),
          eq(acquirerConnections.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!conn)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Conexão não encontrada', request_id: '' })

    const adapter = getAdapter(conn.provider as AcquirerProviderKey)
    const credentials = conn.credentialsEncrypted ? JSON.parse(conn.credentialsEncrypted) : {}
    const fetched = await adapter.fetchSales(credentials, conn.sandbox, {
      from: parsed.from,
      to: parsed.to,
    })

    let imported = 0
    let skipped = 0
    for (const raw of fetched) {
      try {
        await db.insert(acquirerSales).values({
          tenantId: session.logifit.tenantId,
          companyId: conn.companyId,
          connectionId: conn.id,
          externalId: raw.externalId,
          capturedAt: new Date(raw.capturedAt),
          grossAmountCents: raw.grossAmountCents,
          feeCents: raw.feeCents,
          netAmountCents: raw.netAmountCents,
          cardBrand: raw.cardBrand,
          cardKind: raw.cardKind,
          installments: raw.installments,
          expectedSettlementDate: raw.expectedSettlementDate,
          actualSettlementDate: raw.actualSettlementDate,
          status: raw.status,
          rawPayload: raw.rawPayload,
        })
        imported += 1
      } catch (err) {
        const code = (err as { code?: string }).code ?? ''
        if (code === '23505') skipped += 1
        else throw err
      }
    }

    await db
      .update(acquirerConnections)
      .set({
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(acquirerConnections.id, conn.id))

    setAuditResource(conn.id, { imported, skipped, fetched: fetched.length })
    return { imported, skipped, total: fetched.length }
  },
)

// ─── listAcquirerSales ───────────────────────────────────────────────────

export const listAcquirerSales = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.list_sales' },
  async (input: z.infer<typeof ListAcquirerSalesInputSchema> | undefined, { session }) => {
    const parsed = ListAcquirerSalesInputSchema.parse(input ?? {})
    const where = [eq(acquirerSales.tenantId, session.logifit.tenantId)]
    if (parsed.connectionId) where.push(eq(acquirerSales.connectionId, parsed.connectionId))
    if (parsed.companyId) where.push(eq(acquirerSales.companyId, parsed.companyId))
    if (parsed.status && parsed.status !== 'all')
      where.push(eq(acquirerSales.status, parsed.status))
    if (parsed.reconciled === 'yes') where.push(sql`${acquirerSales.reconciledAt} IS NOT NULL`)
    if (parsed.reconciled === 'no') where.push(isNull(acquirerSales.reconciledAt))
    if (parsed.from)
      where.push(gte(acquirerSales.capturedAt, new Date(parsed.from + 'T00:00:00Z')))
    if (parsed.to) where.push(lte(acquirerSales.capturedAt, new Date(parsed.to + 'T23:59:59Z')))

    const rows = await db
      .select({
        id: acquirerSales.id,
        connectionId: acquirerSales.connectionId,
        externalId: acquirerSales.externalId,
        capturedAt: acquirerSales.capturedAt,
        grossAmountCents: acquirerSales.grossAmountCents,
        feeCents: acquirerSales.feeCents,
        netAmountCents: acquirerSales.netAmountCents,
        anticipatedAmountCents: acquirerSales.anticipatedAmountCents,
        cardBrand: acquirerSales.cardBrand,
        cardKind: acquirerSales.cardKind,
        installments: acquirerSales.installments,
        expectedSettlementDate: acquirerSales.expectedSettlementDate,
        actualSettlementDate: acquirerSales.actualSettlementDate,
        status: acquirerSales.status,
        reconciledAt: acquirerSales.reconciledAt,
        reconciledWithBankTxId: acquirerSales.reconciledWithBankTxId,
      })
      .from(acquirerSales)
      .where(and(...where))
      .orderBy(desc(acquirerSales.capturedAt))
      .limit(parsed.limit)
    return { sales: rows }
  },
)

// ─── requestAnticipationAction ───────────────────────────────────────────

export const requestAnticipationAction = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.anticipate', resourceType: 'anticipations' },
  async (
    input: z.infer<typeof RequestAnticipationInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = RequestAnticipationInputSchema.parse(input)
    const [conn] = await db
      .select()
      .from(acquirerConnections)
      .where(
        and(
          eq(acquirerConnections.id, parsed.connectionId),
          eq(acquirerConnections.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!conn)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Conexão não encontrada', request_id: '' })

    // Carrega vendas pra somar valor + validar status
    const sales = await db
      .select({
        id: acquirerSales.id,
        externalId: acquirerSales.externalId,
        netAmountCents: acquirerSales.netAmountCents,
        status: acquirerSales.status,
        connectionId: acquirerSales.connectionId,
      })
      .from(acquirerSales)
      .where(
        and(
          eq(acquirerSales.tenantId, session.logifit.tenantId),
          sql`${acquirerSales.id} = ANY(${parsed.saleIds})`,
        ),
      )

    if (sales.length === 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nenhuma venda elegível encontrada',
        request_id: '',
      })

    const ineligible = sales.find((s) => s.status !== 'captured' && s.status !== 'settled')
    if (ineligible)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Venda ${ineligible.externalId} já antecipada/cancelada`,
        request_id: '',
      })

    const wrongConn = sales.find((s) => s.connectionId !== conn.id)
    if (wrongConn)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Vendas pertencem a conexão diferente',
        request_id: '',
      })

    const originalAmountCents = sales.reduce((s, x) => s + x.netAmountCents, 0)
    const adapter = getAdapter(conn.provider as AcquirerProviderKey)
    const credentials = conn.credentialsEncrypted ? JSON.parse(conn.credentialsEncrypted) : {}
    const result = await adapter.requestAnticipation(credentials, conn.sandbox, {
      salesIds: sales.map((s) => s.id),
      externalSaleIds: sales.map((s) => s.externalId),
      originalAmountCents,
    })

    const [antic] = await db
      .insert(anticipations)
      .values({
        tenantId: session.logifit.tenantId,
        connectionId: conn.id,
        companyId: conn.companyId,
        salesIds: sales.map((s) => s.id),
        originalAmountCents,
        anticipatedAmountCents: result.anticipatedAmountCents,
        feeCents: result.feeCents,
        effectiveRatePct: result.effectiveRatePct,
        status: result.status,
        externalId: result.externalId,
        rejectionReason: result.rejectionReason,
        rawPayload: result.rawPayload,
        requestedByUserId: session.user.id,
        approvedAt: result.status === 'approved' || result.status === 'credited' ? new Date() : null,
        creditedAt: result.status === 'credited' ? new Date() : null,
        rejectedAt: result.status === 'rejected' ? new Date() : null,
      })
      .returning({ id: anticipations.id })

    if (result.status === 'approved' || result.status === 'credited') {
      // Atualiza status das vendas + valor antecipado proporcional
      for (const s of sales) {
        const proportion = s.netAmountCents / originalAmountCents
        const proportional =
          result.anticipatedAmountCents != null
            ? Math.round(result.anticipatedAmountCents * proportion)
            : null
        await db
          .update(acquirerSales)
          .set({
            status: 'anticipated',
            anticipatedAmountCents: proportional,
          })
          .where(eq(acquirerSales.id, s.id))
      }
    }

    setAuditResource(antic!.id, { saleIds: parsed.saleIds, status: result.status })
    return { id: antic!.id, status: result.status, anticipatedCents: result.anticipatedAmountCents }
  },
)

// ─── reconcileSale ───────────────────────────────────────────────────────

export const reconcileSale = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.reconcile', resourceType: 'acquirer_sales' },
  async (input: z.infer<typeof ReconcileSaleInputSchema>, { session, setAuditResource }) => {
    const parsed = ReconcileSaleInputSchema.parse(input)

    // Valida bank_tx pertence ao tenant
    const [bt] = await db
      .select({ id: bankTransactions.id, amountCents: bankTransactions.amountCents })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, parsed.bankTxId),
          eq(bankTransactions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!bt)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Transação bancária não encontrada',
        request_id: '',
      })
    if (bt.amountCents <= 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Settlement de venda exige bank_transaction positiva (crédito)',
        request_id: '',
      })

    const [row] = await db
      .update(acquirerSales)
      .set({
        reconciledWithBankTxId: parsed.bankTxId,
        reconciledAt: new Date(),
        reconciledByUserId: session.user.id,
        status: 'settled',
        actualSettlementDate: new Date().toISOString().slice(0, 10),
      })
      .where(
        and(
          eq(acquirerSales.id, parsed.saleId),
          eq(acquirerSales.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: acquirerSales.id })
    if (!row)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Venda não encontrada', request_id: '' })

    setAuditResource(row.id, { bankTxId: parsed.bankTxId })
    return { id: row.id }
  },
)

// ─── suggestSettlementMatchesAction ──────────────────────────────────────

export const suggestSettlementMatchesAction = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.suggest_matches' },
  async (input: z.infer<typeof SuggestSettlementMatchesInputSchema>, { session }) => {
    const parsed = SuggestSettlementMatchesInputSchema.parse(input)
    const [sale] = await db
      .select({
        id: acquirerSales.id,
        connectionId: acquirerSales.connectionId,
        netAmountCents: acquirerSales.netAmountCents,
        capturedAt: acquirerSales.capturedAt,
        expectedSettlementDate: acquirerSales.expectedSettlementDate,
        cardBrand: acquirerSales.cardBrand,
        cardKind: acquirerSales.cardKind,
      })
      .from(acquirerSales)
      .where(
        and(
          eq(acquirerSales.id, parsed.saleId),
          eq(acquirerSales.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!sale)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Venda não encontrada', request_id: '' })

    const [conn] = await db
      .select({ provider: acquirerConnections.provider })
      .from(acquirerConnections)
      .where(eq(acquirerConnections.id, sale.connectionId))
      .limit(1)
    if (!conn)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Conexão não encontrada', request_id: '' })

    // Carrega bank_transactions positivas ± 7 dias do settlement esperado
    const settlementDate = new Date(sale.expectedSettlementDate + 'T00:00:00Z')
    const fromDate = new Date(settlementDate)
    fromDate.setDate(fromDate.getDate() - 7)
    const toDate = new Date(settlementDate)
    toDate.setDate(toDate.getDate() + 7)

    const bankTxs = await db
      .select({
        id: bankTransactions.id,
        amountCents: bankTransactions.amountCents,
        postedAt: bankTransactions.postedAt,
        description: bankTransactions.description,
        bankAccountId: bankTransactions.bankAccountId,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.tenantId, session.logifit.tenantId),
          isNull(bankTransactions.reconciledAt),
          gte(bankTransactions.postedAt, fromDate),
          lte(bankTransactions.postedAt, toDate),
          sql`${bankTransactions.amountCents} > 0`,
        ),
      )
      .limit(200)

    const saleInput: SaleInput = {
      id: sale.id,
      provider: conn.provider as AcquirerProviderKey,
      cardBrand: sale.cardBrand,
      cardKind: sale.cardKind,
      netAmountCents: sale.netAmountCents,
      expectedSettlementDate: sale.expectedSettlementDate,
      capturedAt: new Date(sale.capturedAt).toISOString(),
    }
    const candidates: BankTxInput[] = bankTxs.map((t) => ({
      id: t.id,
      amountCents: t.amountCents,
      postedAt: new Date(t.postedAt).toISOString(),
      description: t.description,
      bankAccountId: t.bankAccountId,
    }))
    const suggestions = suggestSettlementMatches(saleInput, candidates, {
      maxResults: parsed.maxResults,
    })

    return { suggestions, sale: saleInput }
  },
)

// ─── createAcquirerReconciliationRule ────────────────────────────────────

export const createAcquirerReconciliationRule = wrapServerAction(
  {
    module: 'financeiro',
    action: 'acquirer.rule_create',
    resourceType: 'acquirer_reconciliation_rules',
  },
  async (
    input: z.infer<typeof CreateAcquirerRuleInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateAcquirerRuleInputSchema.parse(input)
    try {
      const [row] = await db
        .insert(acquirerReconciliationRules)
        .values({
          tenantId: session.logifit.tenantId,
          name: parsed.name,
          condition: parsed.condition,
          action: parsed.action,
          targetBankAccountId: parsed.targetBankAccountId ?? null,
          priority: parsed.priority,
          createdByUserId: session.user.id,
        })
        .returning({ id: acquirerReconciliationRules.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar regra',
          request_id: '',
        })
      setAuditResource(row.id, { name: parsed.name })
      return { id: row.id }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe regra com este nome',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listAcquirerReconciliationRules = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.rule_list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select()
      .from(acquirerReconciliationRules)
      .where(
        and(
          eq(acquirerReconciliationRules.tenantId, session.logifit.tenantId),
          isNull(acquirerReconciliationRules.archivedAt),
        ),
      )
      .orderBy(asc(acquirerReconciliationRules.priority))
    return { rules: rows }
  },
)

export const archiveAcquirerReconciliationRule = wrapServerAction(
  {
    module: 'financeiro',
    action: 'acquirer.rule_archive',
    resourceType: 'acquirer_reconciliation_rules',
  },
  async (
    input: z.infer<typeof ArchiveAcquirerRuleInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ArchiveAcquirerRuleInputSchema.parse(input)
    const [row] = await db
      .update(acquirerReconciliationRules)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(
        and(
          eq(acquirerReconciliationRules.id, parsed.ruleId),
          eq(acquirerReconciliationRules.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: acquirerReconciliationRules.id })
    if (!row)
      throw new ApiException({ code: 'NOT_FOUND', message: 'Regra não encontrada', request_id: '' })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── getUnifiedRevenue ───────────────────────────────────────────────────
/**
 * Receita unificada: online (Sprint 04 invoices.paid) + presencial (acquirer_sales).
 *
 * Receita presencial considera **netAmountCents** quando settled/anticipated;
 * **gross** quando captured (ainda não bateu no banco). Gera 2 buckets pra dashboard.
 */
export const getUnifiedRevenue = wrapServerAction(
  { module: 'financeiro', action: 'acquirer.unified_revenue' },
  async (input: z.infer<typeof GetUnifiedRevenueInputSchema>, { session }) => {
    const parsed = GetUnifiedRevenueInputSchema.parse(input)
    const fromDate = new Date(parsed.periodFrom + 'T00:00:00Z')
    const toDate = new Date(parsed.periodTo + 'T23:59:59Z')

    // Online (Sprint 04 invoices)
    const onlineWhere = [
      eq(invoices.tenantId, session.logifit.tenantId),
      eq(invoices.status, 'paid'),
      gte(invoices.paidAt, fromDate),
      lte(invoices.paidAt, toDate),
    ]
    if (parsed.companyId) onlineWhere.push(eq(invoices.companyId, parsed.companyId))
    const [online] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        amountCents: sql<number>`COALESCE(SUM(${invoices.amountCents}), 0)::bigint`,
      })
      .from(invoices)
      .where(and(...onlineWhere))

    // Presencial (acquirer_sales) — net amount quando concluído
    const presentialWhere = [
      eq(acquirerSales.tenantId, session.logifit.tenantId),
      gte(acquirerSales.capturedAt, fromDate),
      lte(acquirerSales.capturedAt, toDate),
      sql`${acquirerSales.status} != 'cancelled'`,
      sql`${acquirerSales.status} != 'chargeback'`,
    ]
    if (parsed.companyId) presentialWhere.push(eq(acquirerSales.companyId, parsed.companyId))
    const [presential] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        grossCents: sql<number>`COALESCE(SUM(${acquirerSales.grossAmountCents}), 0)::bigint`,
        netCents: sql<number>`COALESCE(SUM(${acquirerSales.netAmountCents}), 0)::bigint`,
        feeCents: sql<number>`COALESCE(SUM(${acquirerSales.feeCents}), 0)::bigint`,
      })
      .from(acquirerSales)
      .where(and(...presentialWhere))

    return {
      online: {
        count: online?.count ?? 0,
        amountCents: Number(online?.amountCents ?? 0),
      },
      presential: {
        count: presential?.count ?? 0,
        grossCents: Number(presential?.grossCents ?? 0),
        netCents: Number(presential?.netCents ?? 0),
        feeCents: Number(presential?.feeCents ?? 0),
      },
      totalCents:
        Number(online?.amountCents ?? 0) + Number(presential?.netCents ?? 0),
    }
  },
)

// ─── Helpers públicos pra UI ─────────────────────────────────────────────

export async function quoteAnticipationPreview(input: {
  saleIds: string[]
  tenantId: string
}): Promise<{
  originalCents: number
  feeCents: number
  anticipatedCents: number
  effectiveRatePct: string
  daysSaved: number
}> {
  const sales = await db
    .select({
      netAmountCents: acquirerSales.netAmountCents,
      expectedSettlementDate: acquirerSales.expectedSettlementDate,
    })
    .from(acquirerSales)
    .where(
      and(
        eq(acquirerSales.tenantId, input.tenantId),
        sql`${acquirerSales.id} = ANY(${input.saleIds})`,
      ),
    )
  const original = sales.reduce((s, x) => s + x.netAmountCents, 0)
  const today = new Date().toISOString().slice(0, 10)
  // Média ponderada de dias até settlement
  const avgDays =
    sales.length === 0
      ? 0
      : Math.round(
          sales.reduce((s, x) => {
            const dd =
              (new Date(x.expectedSettlementDate + 'T00:00:00Z').getTime() -
                new Date(today + 'T00:00:00Z').getTime()) /
              (24 * 60 * 60 * 1000)
            return s + Math.max(0, dd)
          }, 0) / sales.length,
        )
  return quoteAnticipation({ originalAmountCents: original, daysToOriginalSettlement: avgDays })
}

export function computeSaleCostPreview(input: {
  grossAmountCents: number
  cardKind: 'credit' | 'debit' | 'voucher' | 'pix' | 'other'
  installments: number
  provider: AcquirerProviderKey
}) {
  const feeRatePct = feeRateFor(input.provider, input.cardKind, input.installments)
  return computeSaleCost({
    grossAmountCents: input.grossAmountCents,
    cardKind: input.cardKind,
    installments: input.installments,
    feeRatePct,
  })
}
