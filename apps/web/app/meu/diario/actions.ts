'use server'

/**
 * Server Actions Diário do paciente (portal /meu/diario) — Sprint 31 Faixa B.2.
 *
 * Caller é PACIENTE (member portal Sprint 26). Usa `wrapMemberAction`
 * (Sprint 02c2 — apps/web/app/lib/wrap-member-action.ts).
 *
 * Actions:
 *   - logMeal({date, mealName, items[], freeText?, notes?, photoStoragePath?})
 *   - listMyDiary({fromDate?, toDate?, mealName?})
 *   - getDiaryEntry({entryId}) — detalhe de uma entry própria
 *   - deleteDiaryEntry({entryId}) — paciente pode apagar próprias entries
 *
 * Cálculo nutricional acontece no servidor (carrega foods + nutrients +
 * lib pura calculateDailyDiarySummary). `calculated_nutrition jsonb` populado.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { z } from 'zod'
import { wrapMemberAction } from '../../lib/wrap-member-action'

const MEAL_NAME_ENUM = [
  'cafe',
  'lanche_manha',
  'almoco',
  'lanche_tarde',
  'jantar',
  'ceia',
  'pre_treino',
  'pos_treino',
  'outro',
] as const

const LogMealItemSchema = z.object({
  foodId: z.string().uuid(),
  grams: z.number().positive().max(5000),
  measure: z.string().max(80).optional().nullable(),
})

const LogMealSchema = z.object({
  consumedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealName: z.enum(MEAL_NAME_ENUM),
  consumedAt: z.string().datetime().optional().nullable(),
  /** Items estruturados — opcional se houver freeText/foto */
  items: z.array(LogMealItemSchema).optional().default([]),
  freeTextDescription: z.string().max(2000).optional().nullable(),
  photoStoragePath: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

const ListDiarySchema = z.object({
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
  mealName: z.enum(MEAL_NAME_ENUM).optional().nullable(),
  limit: z.number().int().min(1).max(200).default(60),
})

const EntryIdSchema = z.object({ entryId: z.string().uuid() })

// ─── logMeal ─────────────────────────────────────────────────────────────

export const logMeal = wrapMemberAction(
  {
    module: 'meu.diario',
    action: 'diary.log_meal',
    returnTo: '/meu/diario/novo',
    resourceType: 'meal_log_entries',
    schema: LogMealSchema,
    eventKind: 'meu.diary.meal_logged',
  },
  async (input, { session }) => {
    const {
      consumedDate,
      mealName,
      consumedAt,
      items,
      freeTextDescription,
      photoStoragePath,
      notes,
    } = input

    // Pelo menos 1 fonte de conteúdo (check constraint)
    if (items.length === 0 && !freeTextDescription && !photoStoragePath) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Informe pelo menos um alimento, descrição em texto ou foto',
        request_id: '',
      })
    }

    // 1. Carregar nutrients dos foods estruturados (se houver) e calcular agregado
    const calculatedNutrition: Record<string, number> = {
      kcal: 0,
      protein_g: 0,
      lipid_g: 0,
      carbohydrate_g: 0,
    }
    if (items.length > 0) {
      const foodIds = items.map((i) => i.foodId)
      // foods pode ser global (tenant_id IS NULL) ou do próprio tenant — nunca de outro tenant
      const foods = await pool.query<{ id: string; nutrients: Record<string, number> }>(
        `SELECT id, nutrients FROM foods
         WHERE id = ANY($1::uuid[]) AND (tenant_id IS NULL OR tenant_id = $2)`,
        [foodIds, session.tenantId],
      )
      const foodById = new Map(foods.rows.map((f) => [f.id, f.nutrients ?? {}]))
      for (const it of items) {
        const n = foodById.get(it.foodId) ?? {}
        const factor = it.grams / 100
        for (const key of ['kcal', 'protein_g', 'lipid_g', 'carbohydrate_g']) {
          const v = (n[key] as number | undefined) ?? 0
          calculatedNutrition[key] = (calculatedNutrition[key] ?? 0) + v * factor
        }
      }
      // Arredonda
      for (const key of Object.keys(calculatedNutrition)) {
        calculatedNutrition[key] =
          Math.round((calculatedNutrition[key]! + Number.EPSILON) * 10) / 10
      }
    }

    // 2. Resolve meal_plan_id ativo (se houver)
    const mp = await pool.query<{ id: string }>(
      `SELECT id FROM meal_plans
       WHERE tenant_id = $1 AND member_id = $2 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [session.tenantId, session.memberId],
    )
    const mealPlanId = mp.rows[0]?.id ?? null

    // 3. INSERT
    const foodsStructured = items.length > 0 ? JSON.stringify(items) : null
    const r = await pool.query<{ id: string }>(
      `INSERT INTO meal_log_entries
       (tenant_id, member_id, meal_plan_id, consumed_date, meal_name, consumed_at,
        foods_structured, free_text_description, photo_storage_path, notes_member,
        calculated_nutrition)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb)
       RETURNING id`,
      [
        session.tenantId,
        session.memberId,
        mealPlanId,
        consumedDate,
        mealName,
        consumedAt,
        foodsStructured,
        freeTextDescription,
        photoStoragePath,
        notes,
        items.length > 0 ? JSON.stringify(calculatedNutrition) : null,
      ],
    )

    return {
      ok: true as const,
      id: r.rows[0]!.id,
      calculatedNutrition: items.length > 0 ? calculatedNutrition : null,
    }
  },
)

// ─── listMyDiary ─────────────────────────────────────────────────────────

interface DiaryRow {
  id: string
  consumed_date: Date
  meal_name: string
  consumed_at: Date | null
  free_text_description: string | null
  photo_storage_path: string | null
  notes_member: string | null
  calculated_nutrition: Record<string, number> | null
  review_status: string | null
  reviewed_at: Date | null
  created_at: Date
}

export const listMyDiary = wrapMemberAction(
  {
    module: 'meu.diario',
    action: 'diary.list',
    returnTo: '/meu/diario',
    schema: ListDiarySchema,
  },
  async (input, { session }) => {
    const conditions: string[] = ['member_id = $1']
    const params: unknown[] = [session.memberId]
    let i = 2
    if (input.fromDate) {
      conditions.push(`consumed_date >= $${i++}`)
      params.push(input.fromDate)
    }
    if (input.toDate) {
      conditions.push(`consumed_date <= $${i++}`)
      params.push(input.toDate)
    }
    if (input.mealName) {
      conditions.push(`meal_name = $${i++}::meal_name_enum`)
      params.push(input.mealName)
    }
    params.push(input.limit)

    const r = await pool.query<DiaryRow>(
      `SELECT id, consumed_date, meal_name, consumed_at, free_text_description,
              photo_storage_path, notes_member, calculated_nutrition, review_status,
              reviewed_at, created_at
       FROM meal_log_entries
       WHERE ${conditions.join(' AND ')}
       ORDER BY consumed_date DESC, consumed_at DESC NULLS LAST
       LIMIT $${i}`,
      params,
    )
    return { ok: true as const, rows: r.rows }
  },
)

// ─── getDiaryEntry ─────────────────────────────────────────────────────────

export const getDiaryEntry = wrapMemberAction(
  {
    module: 'meu.diario',
    action: 'diary.get',
    returnTo: '/meu/diario',
    schema: EntryIdSchema,
  },
  async (input, { session }) => {
    const r = await pool.query<DiaryRow & { foods_structured: unknown }>(
      `SELECT id, consumed_date, meal_name, consumed_at, foods_structured,
              free_text_description, photo_storage_path, notes_member, calculated_nutrition,
              review_status, reviewed_at, created_at
       FROM meal_log_entries
       WHERE id = $1 AND member_id = $2
       LIMIT 1`,
      [input.entryId, session.memberId],
    )
    const entry = r.rows[0]
    if (!entry) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Entrada não encontrada',
        request_id: '',
      })
    }
    return { ok: true as const, entry }
  },
)

// ─── deleteDiaryEntry ────────────────────────────────────────────────────

export const deleteDiaryEntry = wrapMemberAction(
  {
    module: 'meu.diario',
    action: 'diary.delete',
    returnTo: '/meu/diario',
    resourceType: 'meal_log_entries',
    schema: EntryIdSchema,
    eventKind: 'meu.diary.meal_deleted',
  },
  async (input, { session }) => {
    const r = await pool.query(`DELETE FROM meal_log_entries WHERE id = $1 AND member_id = $2`, [
      input.entryId,
      session.memberId,
    ])
    if (r.rowCount === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Entrada não encontrada',
        request_id: '',
      })
    }
    return { ok: true as const }
  },
)
