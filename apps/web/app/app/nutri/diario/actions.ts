'use server'

/**
 * Server Actions Diário (nutri view) — Sprint 31 Faixa B.2.
 *
 * Caller é STAFF (nutri). Usa wrapServerAction com session.logifit.tenantId.
 *
 * Actions:
 *   - listMemberDiary({memberId, fromDate, toDate})
 *   - validateMealEntry({entryId, status, comment?}) — cria meal_log_reviews + atualiza cache
 *   - listPendingReviews({limit}) — fila do nutri
 *   - generateDiaryReport({memberId, fromDate, toDate}) — agregado para PDF
 */

import { db } from '@repo/db/client'
import { mealLogEntries, mealLogReviews, members, persons } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

const ListMemberDiarySchema = z.object({
  memberId: z.string().uuid(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
})

const ValidateSchema = z.object({
  entryId: z.string().uuid(),
  status: z.enum(['approved', 'needs_adjustment', 'flagged']),
  comment: z.string().max(2000).optional().nullable(),
})

const ListPendingSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
  })
  .optional()

const GenerateReportSchema = z.object({
  memberId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// ─── listMemberDiary ────────────────────────────────────────────────────

export const listMemberDiary = wrapServerAction(
  { module: 'nutri', action: 'diary.list' },
  async (input: z.infer<typeof ListMemberDiarySchema>, { session }) => {
    const parsed = ListMemberDiarySchema.parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [
      eq(mealLogEntries.tenantId, tenantId),
      eq(mealLogEntries.memberId, parsed.memberId),
    ]
    if (parsed.fromDate) conditions.push(gte(mealLogEntries.consumedDate, parsed.fromDate))
    if (parsed.toDate) conditions.push(lte(mealLogEntries.consumedDate, parsed.toDate))

    const rows = await db
      .select({
        id: mealLogEntries.id,
        consumedDate: mealLogEntries.consumedDate,
        mealName: mealLogEntries.mealName,
        consumedAt: mealLogEntries.consumedAt,
        foodsStructured: mealLogEntries.foodsStructured,
        freeTextDescription: mealLogEntries.freeTextDescription,
        photoStoragePath: mealLogEntries.photoStoragePath,
        notesMember: mealLogEntries.notesMember,
        calculatedNutrition: mealLogEntries.calculatedNutrition,
        reviewStatus: mealLogEntries.reviewStatus,
        reviewedAt: mealLogEntries.reviewedAt,
        createdAt: mealLogEntries.createdAt,
      })
      .from(mealLogEntries)
      .where(and(...conditions))
      .orderBy(desc(mealLogEntries.consumedDate))
      .limit(200)

    return { ok: true as const, rows }
  },
)

// ─── validateMealEntry ───────────────────────────────────────────────────

export const validateMealEntry = wrapServerAction(
  {
    module: 'nutri',
    action: 'diary.review',
    resourceType: 'meal_log_reviews',
  },
  async (input: z.infer<typeof ValidateSchema>, { session, setAuditResource }) => {
    const parsed = ValidateSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida entry existe + tenant
    const [entry] = await db
      .select({ id: mealLogEntries.id })
      .from(mealLogEntries)
      .where(and(eq(mealLogEntries.id, parsed.entryId), eq(mealLogEntries.tenantId, tenantId)))
      .limit(1)
    if (!entry) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Entrada não encontrada',
        request_id: '',
      })
    }

    const reviewId = await db.transaction(async (tx) => {
      // Cria review row
      const [r] = await tx
        .insert(mealLogReviews)
        .values({
          tenantId,
          entryId: parsed.entryId,
          reviewedByUserId: session.logifit.userId,
          status: parsed.status,
          comment: parsed.comment ?? null,
        })
        .returning({ id: mealLogReviews.id })
      // Atualiza cache no entry
      await tx
        .update(mealLogEntries)
        .set({
          reviewStatus: parsed.status,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mealLogEntries.id, parsed.entryId))
      return r!.id
    })

    setAuditResource(reviewId, {
      entry_id: parsed.entryId,
      status: parsed.status,
    })
    return { ok: true as const, id: reviewId }
  },
)

// ─── listPendingReviews ──────────────────────────────────────────────────

export const listPendingReviews = wrapServerAction(
  { module: 'nutri', action: 'diary.pending' },
  async (input: unknown, { session }) => {
    const parsed = ListPendingSchema.parse(input ?? {}) ?? { limit: 50 }
    const tenantId = session.logifit.tenantId

    const rows = await db
      .select({
        id: mealLogEntries.id,
        memberId: mealLogEntries.memberId,
        memberName: persons.name,
        consumedDate: mealLogEntries.consumedDate,
        mealName: mealLogEntries.mealName,
        calculatedNutrition: mealLogEntries.calculatedNutrition,
        createdAt: mealLogEntries.createdAt,
      })
      .from(mealLogEntries)
      .innerJoin(members, eq(members.id, mealLogEntries.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(mealLogEntries.tenantId, tenantId), isNull(mealLogEntries.reviewStatus)))
      .orderBy(asc(mealLogEntries.createdAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── generateDiaryReport ─────────────────────────────────────────────────
/**
 * Resumo agregado por dia no período. Usa `food_log_daily_summary` se disponível,
 * caso contrário agrega ao vivo de `meal_log_entries.calculated_nutrition`.
 */
export const generateDiaryReport = wrapServerAction(
  { module: 'nutri', action: 'diary.report' },
  async (input: z.infer<typeof GenerateReportSchema>, { session }) => {
    const parsed = GenerateReportSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Tenta o summary primeiro
    const summaryRows = await db.execute<{
      consumed_date: string
      total_kcal: number
      total_protein_g: number
      total_carb_g: number
      total_fat_g: number
      meals_count: number
      adherence_pct: number | null
    }>(sql`
      SELECT consumed_date, total_kcal::float AS total_kcal, total_protein_g::float AS total_protein_g,
             total_carb_g::float AS total_carb_g, total_fat_g::float AS total_fat_g,
             meals_count, adherence_pct::float AS adherence_pct
      FROM food_log_daily_summary
      WHERE tenant_id = ${tenantId}
        AND member_id = ${parsed.memberId}
        AND consumed_date BETWEEN ${parsed.fromDate} AND ${parsed.toDate}
      ORDER BY consumed_date ASC
    `)

    if (summaryRows.rows.length > 0) {
      return { ok: true as const, source: 'summary' as const, rows: summaryRows.rows }
    }

    // Fallback: agrega ao vivo
    const liveRows = await db.execute<{
      consumed_date: string
      total_kcal: number
      total_protein_g: number
      total_carb_g: number
      total_fat_g: number
      meals_count: number
    }>(sql`
      SELECT consumed_date,
             SUM(COALESCE((calculated_nutrition->>'kcal')::numeric, 0))::float AS total_kcal,
             SUM(COALESCE((calculated_nutrition->>'protein_g')::numeric, 0))::float AS total_protein_g,
             SUM(COALESCE((calculated_nutrition->>'carbohydrate_g')::numeric, 0))::float AS total_carb_g,
             SUM(COALESCE((calculated_nutrition->>'lipid_g')::numeric, 0))::float AS total_fat_g,
             COUNT(*)::int AS meals_count
      FROM meal_log_entries
      WHERE tenant_id = ${tenantId}
        AND member_id = ${parsed.memberId}
        AND consumed_date BETWEEN ${parsed.fromDate} AND ${parsed.toDate}
      GROUP BY consumed_date
      ORDER BY consumed_date ASC
    `)

    return { ok: true as const, source: 'live' as const, rows: liveRows.rows }
  },
)
