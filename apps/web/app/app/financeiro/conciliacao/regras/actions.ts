'use server'

/**
 * Server Actions reconciliation_rules — Sprint 17 Faixa B.
 */

import { RuleConditionSchema } from '@repo/db/bancos'
import { db } from '@repo/db/client'
import { reconciliationRules } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../../lib/wrap-action'

const CreateRuleInputSchema = z.object({
  name: z.string().min(2).max(120),
  condition: z.unknown(),
  action: z.enum(['auto_match_ap', 'auto_match_ar', 'auto_create_entry', 'flag_for_review']),
  targetSupplierId: z.string().uuid().optional().nullable(),
  targetChartAccountId: z.string().uuid().optional().nullable(),
  targetCompanyId: z.string().uuid().optional().nullable(),
  priority: z.number().int().min(1).max(9999).default(100),
})

const ArchiveRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
})

export const createReconciliationRule = wrapServerAction(
  { module: 'financeiro', action: 'reconcile.rule.create', resourceType: 'reconciliation_rules' },
  async (input: z.infer<typeof CreateRuleInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateRuleInputSchema.parse(input)
    const condValidation = RuleConditionSchema.safeParse(parsed.condition)
    if (!condValidation.success) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Condition inválida: ${condValidation.error.message}`,
        request_id: '',
      })
    }
    try {
      const [row] = await db
        .insert(reconciliationRules)
        .values({
          tenantId: session.logifit.tenantId,
          name: parsed.name,
          condition: condValidation.data,
          action: parsed.action,
          targetSupplierId: parsed.targetSupplierId ?? null,
          targetChartAccountId: parsed.targetChartAccountId ?? null,
          targetCompanyId: parsed.targetCompanyId ?? null,
          priority: parsed.priority,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: reconciliationRules.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar rule',
          request_id: '',
        })
      setAuditResource(row.id, { name: parsed.name, action: parsed.action })
      return { id: row.id }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe rule com esse nome',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listReconciliationRules = wrapServerAction(
  { module: 'financeiro', action: 'reconcile.rule.list' },
  async (input: { includeArchived?: boolean } | undefined, { session }) => {
    const where = [eq(reconciliationRules.tenantId, session.logifit.tenantId)]
    if (!input?.includeArchived) where.push(isNull(reconciliationRules.archivedAt))
    const rows = await db
      .select({
        id: reconciliationRules.id,
        name: reconciliationRules.name,
        condition: reconciliationRules.condition,
        action: reconciliationRules.action,
        priority: reconciliationRules.priority,
        active: reconciliationRules.active,
        hitsCount: reconciliationRules.hitsCount,
        targetSupplierId: reconciliationRules.targetSupplierId,
        targetChartAccountId: reconciliationRules.targetChartAccountId,
        targetCompanyId: reconciliationRules.targetCompanyId,
        archivedAt: reconciliationRules.archivedAt,
        createdAt: reconciliationRules.createdAt,
      })
      .from(reconciliationRules)
      .where(and(...where))
      .orderBy(asc(reconciliationRules.priority))
    return { rules: rows }
  },
)

export const archiveReconciliationRule = wrapServerAction(
  { module: 'financeiro', action: 'reconcile.rule.archive', resourceType: 'reconciliation_rules' },
  async (input: z.infer<typeof ArchiveRuleInputSchema>, { session, setAuditResource }) => {
    const parsed = ArchiveRuleInputSchema.parse(input)
    const [row] = await db
      .update(reconciliationRules)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(
        and(
          eq(reconciliationRules.id, parsed.ruleId),
          eq(reconciliationRules.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: reconciliationRules.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Rule não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)
