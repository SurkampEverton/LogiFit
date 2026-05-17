'use server'

/**
 * Server Actions Bancos — Sprint 17 Faixa B.
 *
 * MVP (sem provider real Open Finance — Sprint 17b/POC):
 *   - createBankAccount / listBankAccounts / archiveBankAccount
 *   - importOfx — recebe conteúdo OFX, parseia, persiste bank_transactions
 *     (idempotente via unique (bank_account, external_id))
 *   - listBankTransactions (filtros account/period/reconciled)
 *   - confirmMatch(bankTxId, target='ap'|'ar', targetId) — marca conciliação
 *   - rejectMatch(bankTxId) — limpa sugestão (não persiste, apenas marca futura)
 *   - suggestMatches(bankTxId) — busca candidatos similares e roda heurística
 *
 * Open Finance Server Actions (`connectBankAccount`, `refreshBankAccount`)
 * ficam como **stub** retornando NOT_IMPLEMENTED até POC do provider (ADR 0037).
 */

import { db } from '@repo/db/client'
import {
  parseOfx,
  suggestMatches as suggestMatchesHeuristic,
  type PaymentCandidate,
} from '@repo/db/bancos'
import {
  accountsPayable,
  accountsReceivable,
  bankAccounts,
  bankTransactions,
  chartOfAccounts,
  persons,
  suppliers,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateBankAccountInputSchema = z.object({
  companyId: z.string().uuid(),
  bankCode: z.string().min(3).max(10),
  bankName: z.string().min(2).max(120),
  agency: z.string().max(20).optional().nullable(),
  accountNumber: z.string().min(2).max(30),
  accountDigit: z.string().max(4).optional().nullable(),
  kind: z.enum(['checking', 'savings', 'business', 'cashbox']).default('business'),
  openingBalanceCents: z.number().int().default(0),
  nickname: z.string().max(120).optional().nullable(),
})

const ArchiveBankAccountInputSchema = z.object({
  bankAccountId: z.string().uuid(),
})

const ImportOfxInputSchema = z.object({
  bankAccountId: z.string().uuid(),
  ofxContent: z.string().min(20).max(5_000_000), // até 5MB
})

const ListTransactionsInputSchema = z.object({
  bankAccountId: z.string().uuid().optional(),
  reconciled: z.enum(['yes', 'no', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

const ConfirmMatchInputSchema = z.object({
  bankTxId: z.string().uuid(),
  target: z.enum(['ap', 'ar']),
  targetId: z.string().uuid(),
})

const SuggestMatchesInputSchema = z.object({
  bankTxId: z.string().uuid(),
  maxResults: z.number().int().min(1).max(10).default(3),
})

// ─── createBankAccount ────────────────────────────────────────────────────

export const createBankAccount = wrapServerAction(
  { module: 'financeiro', action: 'bank.create', resourceType: 'bank_accounts' },
  async (
    input: z.infer<typeof CreateBankAccountInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateBankAccountInputSchema.parse(input)
    try {
      const [row] = await db
        .insert(bankAccounts)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: parsed.companyId,
          bankCode: parsed.bankCode,
          bankName: parsed.bankName,
          agency: parsed.agency ?? null,
          accountNumber: parsed.accountNumber,
          accountDigit: parsed.accountDigit ?? null,
          kind: parsed.kind,
          openingBalanceCents: parsed.openingBalanceCents,
          currentBalanceCents: parsed.openingBalanceCents,
          nickname: parsed.nickname ?? null,
          createdByUserId: session.user.id,
        })
        .returning({ id: bankAccounts.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar conta bancária',
          request_id: '',
        })
      setAuditResource(row.id, { bankCode: parsed.bankCode })
      return { id: row.id }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe conta cadastrada com mesmo banco/agência/número nesta company',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── listBankAccounts ─────────────────────────────────────────────────────

export const listBankAccounts = wrapServerAction(
  { module: 'financeiro', action: 'bank.list' },
  async (
    input: { includeArchived?: boolean; companyId?: string } | undefined,
    { session },
  ) => {
    const where = [eq(bankAccounts.tenantId, session.logifit.tenantId)]
    if (!input?.includeArchived) where.push(isNull(bankAccounts.archivedAt))
    if (input?.companyId) where.push(eq(bankAccounts.companyId, input.companyId))
    const rows = await db
      .select({
        id: bankAccounts.id,
        companyId: bankAccounts.companyId,
        bankCode: bankAccounts.bankCode,
        bankName: bankAccounts.bankName,
        agency: bankAccounts.agency,
        accountNumber: bankAccounts.accountNumber,
        accountDigit: bankAccounts.accountDigit,
        kind: bankAccounts.kind,
        nickname: bankAccounts.nickname,
        currentBalanceCents: bankAccounts.currentBalanceCents,
        openingBalanceCents: bankAccounts.openingBalanceCents,
        lastSyncedAt: bankAccounts.lastSyncedAt,
        openfinanceConnectionId: bankAccounts.openfinanceConnectionId,
        active: bankAccounts.active,
        archivedAt: bankAccounts.archivedAt,
      })
      .from(bankAccounts)
      .where(and(...where))
      .orderBy(asc(bankAccounts.bankName))
    return { accounts: rows }
  },
)

// ─── archiveBankAccount ──────────────────────────────────────────────────

export const archiveBankAccount = wrapServerAction(
  { module: 'financeiro', action: 'bank.archive', resourceType: 'bank_accounts' },
  async (
    input: z.infer<typeof ArchiveBankAccountInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ArchiveBankAccountInputSchema.parse(input)
    const [row] = await db
      .update(bankAccounts)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(
        and(
          eq(bankAccounts.id, parsed.bankAccountId),
          eq(bankAccounts.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: bankAccounts.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Conta não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── importOfx ───────────────────────────────────────────────────────────

export const importOfx = wrapServerAction(
  { module: 'financeiro', action: 'bank.import_ofx', resourceType: 'bank_transactions' },
  async (
    input: z.infer<typeof ImportOfxInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ImportOfxInputSchema.parse(input)
    const [bank] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, parsed.bankAccountId),
          eq(bankAccounts.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!bank)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Conta bancária não encontrada',
        request_id: '',
      })

    const parsedOfx = parseOfx(parsed.ofxContent)
    if (parsedOfx.transactions.length === 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'OFX não contém transações válidas',
        request_id: '',
      })
    }

    let imported = 0
    let skipped = 0
    for (const tx of parsedOfx.transactions) {
      try {
        await db.insert(bankTransactions).values({
          tenantId: session.logifit.tenantId,
          bankAccountId: parsed.bankAccountId,
          externalId: tx.fitId,
          postedAt: new Date(tx.postedAt),
          amountCents: tx.amountCents,
          description: tx.description,
          memo: tx.memo ?? null,
          source: 'ofx',
          rawPayload: {
            fitId: tx.fitId,
            type: tx.type,
          },
        })
        imported += 1
      } catch (err) {
        const code = (err as { code?: string }).code ?? ''
        if (code === '23505') {
          skipped += 1
        } else {
          throw err
        }
      }
    }

    // Atualiza saldo cached (sum opening + transactions)
    if (parsedOfx.ledgerBalanceCents != null) {
      await db
        .update(bankAccounts)
        .set({
          currentBalanceCents: parsedOfx.ledgerBalanceCents,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankAccounts.id, parsed.bankAccountId))
    } else {
      // Saldo via aggregação local
      const [agg] = await db
        .select({
          sum: sql<number>`COALESCE(SUM(${bankTransactions.amountCents}), 0)::bigint`,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.bankAccountId, parsed.bankAccountId))
      const [b] = await db
        .select({ opening: bankAccounts.openingBalanceCents })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, parsed.bankAccountId))
      const newBalance = Number(b?.opening ?? 0) + Number(agg?.sum ?? 0)
      await db
        .update(bankAccounts)
        .set({
          currentBalanceCents: newBalance,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankAccounts.id, parsed.bankAccountId))
    }

    setAuditResource(parsed.bankAccountId, { imported, skipped })
    return { imported, skipped, total: parsedOfx.transactions.length }
  },
)

// ─── listBankTransactions ────────────────────────────────────────────────

export const listBankTransactions = wrapServerAction(
  { module: 'financeiro', action: 'bank.list_tx' },
  async (
    input: z.infer<typeof ListTransactionsInputSchema> | undefined,
    { session },
  ) => {
    const parsed = ListTransactionsInputSchema.parse(input ?? {})
    const where = [eq(bankTransactions.tenantId, session.logifit.tenantId)]
    if (parsed.bankAccountId) where.push(eq(bankTransactions.bankAccountId, parsed.bankAccountId))
    if (parsed.reconciled === 'yes')
      where.push(sql`${bankTransactions.reconciledAt} IS NOT NULL`)
    if (parsed.reconciled === 'no') where.push(isNull(bankTransactions.reconciledAt))
    if (parsed.from) where.push(gte(bankTransactions.postedAt, new Date(parsed.from + 'T00:00:00Z')))
    if (parsed.to) where.push(lte(bankTransactions.postedAt, new Date(parsed.to + 'T23:59:59Z')))

    const rows = await db
      .select({
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        externalId: bankTransactions.externalId,
        postedAt: bankTransactions.postedAt,
        amountCents: bankTransactions.amountCents,
        description: bankTransactions.description,
        memo: bankTransactions.memo,
        source: bankTransactions.source,
        reconciledWithApId: bankTransactions.reconciledWithApId,
        reconciledWithArId: bankTransactions.reconciledWithArId,
        reconciledAt: bankTransactions.reconciledAt,
      })
      .from(bankTransactions)
      .where(and(...where))
      .orderBy(desc(bankTransactions.postedAt))
      .limit(parsed.limit)
    return { transactions: rows }
  },
)

// ─── confirmMatch ────────────────────────────────────────────────────────

export const confirmMatch = wrapServerAction(
  { module: 'financeiro', action: 'bank.confirm_match', resourceType: 'bank_transactions' },
  async (
    input: z.infer<typeof ConfirmMatchInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ConfirmMatchInputSchema.parse(input)
    const update: Record<string, unknown> = {
      reconciledAt: new Date(),
      reconciledByUserId: session.user.id,
    }
    if (parsed.target === 'ap') {
      // valida AP existe no tenant
      const [ap] = await db
        .select({ id: accountsPayable.id })
        .from(accountsPayable)
        .where(
          and(
            eq(accountsPayable.id, parsed.targetId),
            eq(accountsPayable.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!ap)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'AP não encontrada',
          request_id: '',
        })
      update.reconciledWithApId = parsed.targetId
    } else {
      const [ar] = await db
        .select({ id: accountsReceivable.id })
        .from(accountsReceivable)
        .where(
          and(
            eq(accountsReceivable.id, parsed.targetId),
            eq(accountsReceivable.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!ar)
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'AR não encontrada',
          request_id: '',
        })
      update.reconciledWithArId = parsed.targetId
    }
    const [row] = await db
      .update(bankTransactions)
      .set(update)
      .where(
        and(
          eq(bankTransactions.id, parsed.bankTxId),
          eq(bankTransactions.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: bankTransactions.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Transação não encontrada',
        request_id: '',
      })
    setAuditResource(parsed.bankTxId, { target: parsed.target, targetId: parsed.targetId })
    return { id: row.id }
  },
)

// ─── suggestMatchesAction ────────────────────────────────────────────────

export const suggestMatchesAction = wrapServerAction(
  { module: 'financeiro', action: 'bank.suggest_matches' },
  async (input: z.infer<typeof SuggestMatchesInputSchema>, { session }) => {
    const parsed = SuggestMatchesInputSchema.parse(input)
    const [tx] = await db
      .select({
        id: bankTransactions.id,
        amountCents: bankTransactions.amountCents,
        description: bankTransactions.description,
        postedAt: bankTransactions.postedAt,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.id, parsed.bankTxId),
          eq(bankTransactions.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!tx)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Transação não encontrada',
        request_id: '',
      })

    // Carrega candidatos AP/AR pendentes próximos da data (±30 dias)
    const postedDate = new Date(tx.postedAt).toISOString().slice(0, 10)
    const fromDate = new Date(tx.postedAt)
    fromDate.setDate(fromDate.getDate() - 30)
    const toDate = new Date(tx.postedAt)
    toDate.setDate(toDate.getDate() + 30)

    const aps = await db
      .select({
        id: accountsPayable.id,
        amountCents: accountsPayable.netAmountCents,
        dueDate: accountsPayable.dueDate,
        description: accountsPayable.description,
        supplierPersonId: suppliers.personId,
      })
      .from(accountsPayable)
      .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
      .where(
        and(
          eq(accountsPayable.tenantId, session.logifit.tenantId),
          sql`${accountsPayable.status} IN ('approved', 'scheduled', 'pending_approval')`,
          gte(accountsPayable.dueDate, fromDate.toISOString().slice(0, 10)),
          lte(accountsPayable.dueDate, toDate.toISOString().slice(0, 10)),
        ),
      )
      .limit(100)
    const ars = await db
      .select({
        id: accountsReceivable.id,
        amountCents: accountsReceivable.amountCents,
        dueDate: accountsReceivable.dueDate,
        description: accountsReceivable.description,
        payerPersonId: accountsReceivable.payerPersonId,
      })
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
          sql`${accountsReceivable.status} IN ('issued', 'overdue', 'draft')`,
          gte(accountsReceivable.dueDate, fromDate.toISOString().slice(0, 10)),
          lte(accountsReceivable.dueDate, toDate.toISOString().slice(0, 10)),
        ),
      )
      .limit(100)

    // Resolve nomes dos persons
    const personIds = new Set<string>()
    aps.forEach((a) => a.supplierPersonId && personIds.add(a.supplierPersonId))
    ars.forEach((a) => a.payerPersonId && personIds.add(a.payerPersonId))
    const personRows =
      personIds.size > 0
        ? await db
            .select({ id: persons.id, name: persons.name })
            .from(persons)
            .where(eq(persons.tenantId, session.logifit.tenantId))
        : []
    const nameByPersonId = new Map(personRows.map((p) => [p.id, p.name]))

    const candidates: PaymentCandidate[] = [
      ...aps.map((a) => ({
        id: a.id,
        kind: 'ap' as const,
        amountCents: a.amountCents,
        dueDate: a.dueDate,
        description: a.description,
        supplierName: a.supplierPersonId ? nameByPersonId.get(a.supplierPersonId) ?? null : null,
      })),
      ...ars.map((a) => ({
        id: a.id,
        kind: 'ar' as const,
        amountCents: a.amountCents,
        dueDate: a.dueDate,
        description: a.description,
        payerName: a.payerPersonId ? nameByPersonId.get(a.payerPersonId) ?? null : null,
      })),
    ]

    const suggestions = suggestMatchesHeuristic(
      {
        id: tx.id,
        amountCents: tx.amountCents,
        description: tx.description,
        postedAt: new Date(tx.postedAt).toISOString(),
      },
      candidates,
      { maxResults: parsed.maxResults },
    )

    return { suggestions, transaction: { ...tx, postedAt: new Date(tx.postedAt).toISOString() } }
  },
)

// ─── Open Finance stubs ──────────────────────────────────────────────────

export const connectBankAccount = wrapServerAction(
  { module: 'financeiro', action: 'bank.openfinance_connect' },
  async (
    _input: { provider: 'pluggy' | 'belvo' },
    { session: _session },
  ) => {
    throw new ApiException({
      code: 'INTERNAL_ERROR',
      message:
        'Open Finance ainda não disponível — provider POC pendente (ADR 0037). Use upload OFX como fallback.',
      request_id: '',
    })
  },
)
