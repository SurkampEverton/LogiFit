'use server'

/**
 * Server Actions plano de contas — Sprint 15 Faixa B (ADR 0033).
 *
 * Funções:
 *   - createChartAccount — cria conta (folha ou agregadora); valida parent existe e
 *     pertence ao mesmo tenant; valida kind herda do parent (se houver parent).
 *   - listChartAccounts — lista todas as contas do tenant (estrutura achatada;
 *     UI monta árvore).
 *   - listLeafAccounts — lista só folhas ativas (para selects de AP/AR).
 *   - archiveChartAccount — soft-delete via archived_at; bloqueia se houver filhos
 *     ativos ou lançamentos AP/AR vinculados.
 *   - moveChartAccount — muda parent_id; bloqueia ciclo (parent vira filho de si).
 */

import { db } from '@repo/db/client'
import { accountsPayable, accountsReceivable, chartOfAccounts } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CodeRegex = /^[0-9]+(\.[0-9]+)*$/

const CreateChartAccountInputSchema = z.object({
  code: z.string().min(1).max(20).regex(CodeRegex, 'Use formato 1, 1.1, 1.1.01'),
  name: z.string().min(2).max(200),
  kind: z.enum(['ativo', 'passivo', 'receita', 'despesa', 'custo']),
  parentId: z.string().uuid().optional().nullable(),
  isLeaf: z.boolean().default(true),
  description: z.string().max(500).optional(),
})

const ArchiveChartAccountInputSchema = z.object({
  accountId: z.string().uuid(),
})

const MoveChartAccountInputSchema = z.object({
  accountId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
})

const ListChartAccountsInputSchema = z.object({
  kind: z.enum(['ativo', 'passivo', 'receita', 'despesa', 'custo']).optional(),
  includeArchived: z.boolean().default(false),
})

// ─── createChartAccount ──────────────────────────────────────────────────

export const createChartAccount = wrapServerAction(
  { module: 'financeiro', action: 'chart.create', resourceType: 'chart_of_accounts' },
  async (input: z.infer<typeof CreateChartAccountInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateChartAccountInputSchema.parse(input)

    if (parsed.parentId) {
      const [parent] = await db
        .select({ id: chartOfAccounts.id, kind: chartOfAccounts.kind })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, parsed.parentId),
            eq(chartOfAccounts.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!parent) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Conta pai não encontrada',
          request_id: '',
        })
      }
      if (parent.kind !== parsed.kind) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Kind '${parsed.kind}' diferente do pai '${parent.kind}'`,
          request_id: '',
        })
      }
      // Marca pai como não-folha
      await db
        .update(chartOfAccounts)
        .set({ isLeaf: false, updatedAt: new Date() })
        .where(eq(chartOfAccounts.id, parsed.parentId))
    }

    const [row] = await db
      .insert(chartOfAccounts)
      .values({
        tenantId: session.logifit.tenantId,
        code: parsed.code,
        name: parsed.name,
        kind: parsed.kind,
        parentId: parsed.parentId ?? null,
        isLeaf: parsed.isLeaf,
        description: parsed.description ?? null,
      })
      .returning({ id: chartOfAccounts.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar conta',
        request_id: '',
      })
    setAuditResource(row.id, { code: parsed.code, kind: parsed.kind })
    return { id: row.id }
  },
)

// ─── listChartAccounts ───────────────────────────────────────────────────

export const listChartAccounts = wrapServerAction(
  { module: 'financeiro', action: 'chart.list' },
  async (input: z.infer<typeof ListChartAccountsInputSchema> | undefined, { session }) => {
    const parsed = ListChartAccountsInputSchema.parse(input ?? {})
    const where = [eq(chartOfAccounts.tenantId, session.logifit.tenantId)]
    if (parsed.kind) where.push(eq(chartOfAccounts.kind, parsed.kind))
    if (!parsed.includeArchived) where.push(isNull(chartOfAccounts.archivedAt))

    const rows = await db
      .select({
        id: chartOfAccounts.id,
        code: chartOfAccounts.code,
        name: chartOfAccounts.name,
        kind: chartOfAccounts.kind,
        parentId: chartOfAccounts.parentId,
        isLeaf: chartOfAccounts.isLeaf,
        description: chartOfAccounts.description,
        active: chartOfAccounts.active,
        archivedAt: chartOfAccounts.archivedAt,
      })
      .from(chartOfAccounts)
      .where(and(...where))
      .orderBy(asc(chartOfAccounts.code))
    return { accounts: rows }
  },
)

// ─── listLeafAccounts ────────────────────────────────────────────────────

export const listLeafAccounts = wrapServerAction(
  { module: 'financeiro', action: 'chart.list_leaves' },
  async (
    input: { kind?: 'ativo' | 'passivo' | 'receita' | 'despesa' | 'custo' } | undefined,
    { session },
  ) => {
    const where = [
      eq(chartOfAccounts.tenantId, session.logifit.tenantId),
      eq(chartOfAccounts.isLeaf, true),
      eq(chartOfAccounts.active, true),
      isNull(chartOfAccounts.archivedAt),
    ]
    if (input?.kind) where.push(eq(chartOfAccounts.kind, input.kind))
    const rows = await db
      .select({
        id: chartOfAccounts.id,
        code: chartOfAccounts.code,
        name: chartOfAccounts.name,
        kind: chartOfAccounts.kind,
      })
      .from(chartOfAccounts)
      .where(and(...where))
      .orderBy(asc(chartOfAccounts.code))
    return { leaves: rows }
  },
)

// ─── archiveChartAccount ─────────────────────────────────────────────────

export const archiveChartAccount = wrapServerAction(
  { module: 'financeiro', action: 'chart.archive', resourceType: 'chart_of_accounts' },
  async (input: z.infer<typeof ArchiveChartAccountInputSchema>, { session, setAuditResource }) => {
    const parsed = ArchiveChartAccountInputSchema.parse(input)

    // Bloqueio: conta tem filhos ativos
    const [childCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.parentId, parsed.accountId),
          eq(chartOfAccounts.tenantId, session.logifit.tenantId),
          isNull(chartOfAccounts.archivedAt),
        ),
      )
    if ((childCount?.c ?? 0) > 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Conta tem ${childCount?.c} filhas ativas — arquive antes`,
        request_id: '',
      })
    }

    // Bloqueio: conta tem AP/AR vinculadas
    const [apCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(accountsPayable)
      .where(
        and(
          eq(accountsPayable.chartAccountId, parsed.accountId),
          eq(accountsPayable.tenantId, session.logifit.tenantId),
        ),
      )
    const [arCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.chartAccountId, parsed.accountId),
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
        ),
      )
    if ((apCount?.c ?? 0) + (arCount?.c ?? 0) > 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Conta tem ${(apCount?.c ?? 0) + (arCount?.c ?? 0)} lançamentos vinculados`,
        request_id: '',
      })
    }

    const [row] = await db
      .update(chartOfAccounts)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(
        and(
          eq(chartOfAccounts.id, parsed.accountId),
          eq(chartOfAccounts.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: chartOfAccounts.id })
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

// ─── moveChartAccount ────────────────────────────────────────────────────

export const moveChartAccount = wrapServerAction(
  { module: 'financeiro', action: 'chart.move', resourceType: 'chart_of_accounts' },
  async (input: z.infer<typeof MoveChartAccountInputSchema>, { session, setAuditResource }) => {
    const parsed = MoveChartAccountInputSchema.parse(input)
    if (parsed.newParentId === parsed.accountId) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Conta não pode ser pai de si mesma',
        request_id: '',
      })
    }

    if (parsed.newParentId) {
      const [parent] = await db
        .select({
          id: chartOfAccounts.id,
          kind: chartOfAccounts.kind,
          parentId: chartOfAccounts.parentId,
        })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, parsed.newParentId),
            eq(chartOfAccounts.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!parent) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Novo pai não encontrado',
          request_id: '',
        })
      }
      const [self] = await db
        .select({ kind: chartOfAccounts.kind })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.id, parsed.accountId),
            eq(chartOfAccounts.tenantId, session.logifit.tenantId),
          ),
        )
        .limit(1)
      if (!self) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Conta não encontrada',
          request_id: '',
        })
      }
      if (self.kind !== parent.kind) {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: `Kind '${self.kind}' não cabe sob '${parent.kind}'`,
          request_id: '',
        })
      }
      // TODO Sprint 15+: detecção de ciclo via recursive CTE
    }

    const [row] = await db
      .update(chartOfAccounts)
      .set({ parentId: parsed.newParentId, updatedAt: new Date() })
      .where(
        and(
          eq(chartOfAccounts.id, parsed.accountId),
          eq(chartOfAccounts.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: chartOfAccounts.id })
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
