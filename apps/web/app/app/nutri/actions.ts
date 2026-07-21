'use server'

/**
 * Server Actions Nutri — Sprint 29 Faixa B.2 (ADRs 0080 + 0081).
 *
 * Actions:
 *   - searchFoods(query, filters)
 *   - getFoodDetail(foodId)
 *   - createTenantFood(input)
 *   - listMealPlans(memberId?) — lista planos do tenant ou de um member
 *   - createMealPlan(input) — cria + opcionalmente vincula prescription Sprint 11
 *   - getMealPlanFull(planId) — meal_plan + meals + items + nutrients totals
 *   - updateMealPlan(planId, updates) — cria nova versão (parent_meal_plan_id)
 *   - calculateNutrition(planId) — utilitário público
 *   - listSubstitutions(itemId, topN?) — top-N equivalentes calóricos
 *   - upsertBranding(input)
 *   - getBranding()
 *
 * Lint custom `no-unwrapped-action` exige `wrapServerAction`.
 */

import { db } from '@repo/db/client'
import {
  type MealInput,
  type Nutrients,
  type RawEquivalenceRow,
  calculateMealPlanNutrition,
  compareAgainstTargets,
  parseNutrients,
  rankEquivalents,
} from '@repo/db/nutri'
import {
  foodEquivalences,
  foodMeasures,
  foods,
  mealItems,
  mealPlanMeals,
  mealPlans,
  members,
  tenantBranding,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const FOOD_CATEGORY_ENUM = [
  'cereais_e_derivados',
  'verduras_hortalicas',
  'frutas',
  'gorduras_e_oleos',
  'pescados_e_frutos_do_mar',
  'carnes_e_derivados',
  'leite_e_derivados',
  'bebidas',
  'ovos_e_derivados',
  'produtos_acucarados',
  'miscelaneos',
  'alimentos_industrializados',
  'leguminosas',
  'nozes_e_sementes',
  'preparacoes',
] as const

const SearchFoodsInputSchema = z.object({
  query: z.string().max(120).optional().nullable(),
  category: z.enum(FOOD_CATEGORY_ENUM).optional().nullable(),
  /** Inclui catálogo global (default true) */
  includeGlobal: z.boolean().default(true),
  /** Inclui custom do tenant (default true) */
  includeTenantCustom: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
})

const GetFoodDetailSchema = z.object({
  foodId: z.string().uuid(),
})

const CreateTenantFoodSchema = z.object({
  source: z.literal('custom'),
  name: z.string().min(2).max(200),
  category: z.enum(FOOD_CATEGORY_ENUM),
  subcategory: z.string().max(80).optional().nullable(),
  preparation: z.string().max(80).optional().nullable(),
  nutrients: z.record(z.string(), z.number()),
  measures: z
    .array(
      z.object({
        measure: z.string().min(1).max(80),
        grams: z.number().positive(),
        displayOrder: z.number().int().min(1).default(1),
      }),
    )
    .optional()
    .default([]),
})

const ListMealPlansSchema = z.object({
  memberId: z.string().uuid().optional().nullable(),
  /** Apenas ativos default */
  onlyActive: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
})

const MealItemInputSchema = z.object({
  foodId: z.string().uuid(),
  grams: z.number().positive(),
  measure: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  order: z.number().int().min(1),
})

const MealInputSchemaCreate = z.object({
  name: z.string().min(1).max(60),
  expectedTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
  order: z.number().int().min(1),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(MealItemInputSchema),
})

const CreateMealPlanInputSchema = z.object({
  memberId: z.string().uuid(),
  name: z.string().min(2).max(120),
  goal: z.enum([
    'emagrecimento',
    'ganho_massa',
    'manutencao',
    'baixo_carbo',
    'cetogenico',
    'vegetariano',
    'vegano',
    'diabetico',
    'renal',
    'gestante',
    'esportivo',
    'outro',
  ]),
  targetKcal: z.number().int().min(500).max(6000).optional().nullable(),
  targetProteinG: z.number().min(0).max(500).optional().nullable(),
  targetCarbG: z.number().min(0).max(800).optional().nullable(),
  targetLipidG: z.number().min(0).max(400).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  /** Refeições e items — atomicidade transacional */
  meals: z.array(MealInputSchemaCreate).min(1).max(10),
})

const GetMealPlanFullSchema = z.object({
  planId: z.string().uuid(),
})

const UpdateMealPlanSchema = CreateMealPlanInputSchema.extend({
  parentMealPlanId: z.string().uuid(),
})

const ListSubstitutionsSchema = z.object({
  mealItemId: z.string().uuid(),
  topN: z.number().int().min(1).max(20).default(5),
})

const UpsertBrandingSchema = z.object({
  logoStoragePath: z.string().max(500).optional().nullable(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#3498DB'),
  logoWidthPx: z.number().int().min(40).max(400).default(120),
  signatureStoragePath: z.string().max(500).optional().nullable(),
  professionalNameDefault: z.string().max(120).optional().nullable(),
  footerText: z.string().max(500).optional().nullable(),
})

// ─── searchFoods ─────────────────────────────────────────────────────────

export const searchFoods = wrapServerAction(
  { module: 'nutri', action: 'food.search' },
  async (input: z.infer<typeof SearchFoodsInputSchema>, { session }) => {
    const parsed = SearchFoodsInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [eq(foods.active, true)]
    if (parsed.category) conditions.push(eq(foods.category, parsed.category))
    if (parsed.query && parsed.query.trim().length > 0) {
      conditions.push(ilike(foods.nameNormalized, `%${parsed.query.toLowerCase()}%`))
    }

    // Escopo: global (tenant_id IS NULL) OU tenant atual
    const scopeOr: ReturnType<typeof or>[] = []
    if (parsed.includeGlobal) scopeOr.push(isNull(foods.tenantId))
    if (parsed.includeTenantCustom) scopeOr.push(eq(foods.tenantId, tenantId))
    if (scopeOr.length === 0) {
      return { ok: true as const, rows: [] }
    }

    const rows = await db
      .select({
        id: foods.id,
        tenantId: foods.tenantId,
        source: foods.source,
        name: foods.name,
        category: foods.category,
        subcategory: foods.subcategory,
        nutrients: foods.nutrients,
      })
      .from(foods)
      .where(and(...conditions, or(...scopeOr)))
      .orderBy(asc(foods.name))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── getFoodDetail ───────────────────────────────────────────────────────

export const getFoodDetail = wrapServerAction(
  { module: 'nutri', action: 'food.read' },
  async (input: z.infer<typeof GetFoodDetailSchema>, { session }) => {
    const parsed = GetFoodDetailSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [food] = await db
      .select()
      .from(foods)
      .where(
        and(eq(foods.id, parsed.foodId), or(isNull(foods.tenantId), eq(foods.tenantId, tenantId))),
      )
      .limit(1)

    if (!food) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Alimento não encontrado',
        request_id: '',
      })
    }

    const measures = await db
      .select()
      .from(foodMeasures)
      .where(eq(foodMeasures.foodId, food.id))
      .orderBy(asc(foodMeasures.displayOrder))

    return { ok: true as const, food, measures }
  },
)

// ─── createTenantFood ────────────────────────────────────────────────────

export const createTenantFood = wrapServerAction(
  {
    module: 'nutri',
    action: 'food.create',
    resourceType: 'foods',
  },
  async (input: z.infer<typeof CreateTenantFoodSchema>, { session, setAuditResource }) => {
    const parsed = CreateTenantFoodSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida nutrientes via Zod estrito (lança ZodError caso inválido)
    try {
      parseNutrients(parsed.nutrients)
    } catch (err) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nutrientes inválidos: ' + (err instanceof Error ? err.message : 'unknown'),
        request_id: '',
      })
    }

    const nameNormalized = parsed.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

    const [row] = await db
      .insert(foods)
      .values({
        tenantId,
        source: 'custom',
        name: parsed.name,
        nameNormalized,
        category: parsed.category,
        subcategory: parsed.subcategory ?? null,
        preparation: parsed.preparation ?? null,
        nutrients: parsed.nutrients,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: foods.id })

    if (parsed.measures.length > 0) {
      await db.insert(foodMeasures).values(
        parsed.measures.map((m) => ({
          foodId: row!.id,
          measure: m.measure,
          grams: m.grams.toString(),
          displayOrder: m.displayOrder,
        })),
      )
    }

    setAuditResource(row!.id, { name: parsed.name, category: parsed.category })
    return { ok: true as const, id: row!.id }
  },
)

// ─── listMealPlans ───────────────────────────────────────────────────────

export const listMealPlans = wrapServerAction(
  { module: 'nutri', action: 'meal_plan.list' },
  async (input: z.infer<typeof ListMealPlansSchema>, { session }) => {
    const parsed = ListMealPlansSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [eq(mealPlans.tenantId, tenantId)]
    if (parsed.memberId) conditions.push(eq(mealPlans.memberId, parsed.memberId))
    if (parsed.onlyActive) conditions.push(eq(mealPlans.active, true))

    const rows = await db
      .select({
        id: mealPlans.id,
        memberId: mealPlans.memberId,
        memberName: sql<string>`(SELECT p.name FROM members m INNER JOIN persons p ON p.id = m.person_id WHERE m.id = ${mealPlans.memberId})`,
        name: mealPlans.name,
        goal: mealPlans.goal,
        targetKcal: mealPlans.targetKcal,
        version: mealPlans.version,
        active: mealPlans.active,
        startsAt: mealPlans.startsAt,
        endsAt: mealPlans.endsAt,
        createdAt: mealPlans.createdAt,
      })
      .from(mealPlans)
      .where(and(...conditions))
      .orderBy(desc(mealPlans.createdAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── createMealPlan ──────────────────────────────────────────────────────

export const createMealPlan = wrapServerAction(
  {
    module: 'nutri',
    action: 'meal_plan.create',
    resourceType: 'meal_plans',
  },
  async (input: z.infer<typeof CreateMealPlanInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateMealPlanInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida member existe + escopo
    const m = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (m.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }

    // Valida escopo dos foods referenciados: global (tenant_id IS NULL) OU do tenant.
    // FK foods não carrega constraint de tenant, então checamos explicitamente.
    const foodIds = Array.from(
      new Set(parsed.meals.flatMap((meal) => meal.items.map((it) => it.foodId))),
    )
    if (foodIds.length > 0) {
      const allowedFoods = await db
        .select({ id: foods.id })
        .from(foods)
        .where(
          and(inArray(foods.id, foodIds), or(isNull(foods.tenantId), eq(foods.tenantId, tenantId))),
        )
      if (allowedFoods.length !== foodIds.length) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Alimento não encontrado',
          request_id: '',
        })
      }
    }

    // Insert plan + meals + items em transação
    const planId = await db.transaction(async (tx) => {
      const [planRow] = await tx
        .insert(mealPlans)
        .values({
          tenantId,
          memberId: parsed.memberId,
          name: parsed.name,
          goal: parsed.goal,
          targetKcal: parsed.targetKcal ?? null,
          targetProteinG: parsed.targetProteinG?.toString() ?? null,
          targetCarbG: parsed.targetCarbG?.toString() ?? null,
          targetLipidG: parsed.targetLipidG?.toString() ?? null,
          notes: parsed.notes ?? null,
          version: 1,
          active: true,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: mealPlans.id })
      const pId = planRow!.id

      for (const meal of parsed.meals) {
        const [mealRow] = await tx
          .insert(mealPlanMeals)
          .values({
            tenantId,
            mealPlanId: pId,
            name: meal.name,
            expectedTime: meal.expectedTime ?? null,
            order: meal.order,
            notes: meal.notes ?? null,
          })
          .returning({ id: mealPlanMeals.id })
        const mId = mealRow!.id

        if (meal.items.length > 0) {
          await tx.insert(mealItems).values(
            meal.items.map((it) => ({
              tenantId,
              mealId: mId,
              foodId: it.foodId,
              grams: it.grams.toString(),
              measure: it.measure ?? null,
              notes: it.notes ?? null,
              order: it.order,
            })),
          )
        }
      }

      return pId
    })

    setAuditResource(planId, {
      member_id: parsed.memberId,
      goal: parsed.goal,
      meals_count: parsed.meals.length,
      items_count: parsed.meals.reduce((sum, m) => sum + m.items.length, 0),
    })

    return { ok: true as const, id: planId }
  },
)

// ─── getMealPlanFull ─────────────────────────────────────────────────────
/**
 * Carrega plano + meals + items + nutrients de cada food + calcula totais.
 */
export const getMealPlanFull = wrapServerAction(
  { module: 'nutri', action: 'meal_plan.read' },
  async (input: z.infer<typeof GetMealPlanFullSchema>, { session }) => {
    const parsed = GetMealPlanFullSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [plan] = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, parsed.planId), eq(mealPlans.tenantId, tenantId)))
      .limit(1)
    if (!plan) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Plano não encontrado',
        request_id: '',
      })
    }

    const meals = await db
      .select()
      .from(mealPlanMeals)
      .where(eq(mealPlanMeals.mealPlanId, plan.id))
      .orderBy(asc(mealPlanMeals.order))

    // Só os items das meals deste plano (filtro funcional) + foods no escopo do tenant/global.
    const mealIds = meals.map((mm) => mm.id)
    const allItems =
      mealIds.length === 0
        ? []
        : await db
            .select({
              id: mealItems.id,
              mealId: mealItems.mealId,
              foodId: mealItems.foodId,
              foodName: foods.name,
              nutrients: foods.nutrients,
              grams: mealItems.grams,
              measure: mealItems.measure,
              notes: mealItems.notes,
              order: mealItems.order,
            })
            .from(mealItems)
            .innerJoin(foods, eq(foods.id, mealItems.foodId))
            .where(
              and(
                eq(mealItems.tenantId, tenantId),
                inArray(mealItems.mealId, mealIds),
                or(isNull(foods.tenantId), eq(foods.tenantId, tenantId)),
              ),
            )
            .orderBy(asc(mealItems.order))

    // Agrupa items por meal
    const itemsByMeal = new Map<string, typeof allItems>()
    for (const it of allItems) {
      const arr = itemsByMeal.get(it.mealId) ?? []
      arr.push(it)
      itemsByMeal.set(it.mealId, arr)
    }

    const mealsInput: MealInput[] = meals.map((m) => ({
      mealId: m.id,
      name: m.name,
      order: m.order,
      items: (itemsByMeal.get(m.id) ?? [])
        .filter((it) => mealsInput) // placeholder p/ tipagem
        .map((it) => ({
          foodId: it.foodId,
          foodName: it.foodName,
          grams: Number(it.grams),
          nutrients: it.nutrients as Nutrients,
        })),
    }))

    const nutrition = calculateMealPlanNutrition(mealsInput)
    const gaps = compareAgainstTargets(nutrition.totals, {
      kcal: plan.targetKcal,
      protein_g: plan.targetProteinG ? Number(plan.targetProteinG) : null,
      carbohydrate_g: plan.targetCarbG ? Number(plan.targetCarbG) : null,
      lipid_g: plan.targetLipidG ? Number(plan.targetLipidG) : null,
    })

    return {
      ok: true as const,
      plan,
      meals,
      items: allItems,
      nutrition,
      gaps,
    }
  },
)

// ─── updateMealPlan (cria nova versão) ───────────────────────────────────

export const updateMealPlan = wrapServerAction(
  {
    module: 'nutri',
    action: 'meal_plan.update',
    resourceType: 'meal_plans',
  },
  async (input: z.infer<typeof UpdateMealPlanSchema>, { session, setAuditResource }) => {
    const parsed = UpdateMealPlanSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega parent + valida tenant
    const [parent] = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, parsed.parentMealPlanId), eq(mealPlans.tenantId, tenantId)))
      .limit(1)
    if (!parent) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Plano original não encontrado',
        request_id: '',
      })
    }

    // Valida escopo dos foods referenciados: global (tenant_id IS NULL) OU do tenant.
    // FK foods não carrega constraint de tenant, então checamos explicitamente.
    const foodIds = Array.from(
      new Set(parsed.meals.flatMap((meal) => meal.items.map((it) => it.foodId))),
    )
    if (foodIds.length > 0) {
      const allowedFoods = await db
        .select({ id: foods.id })
        .from(foods)
        .where(
          and(inArray(foods.id, foodIds), or(isNull(foods.tenantId), eq(foods.tenantId, tenantId))),
        )
      if (allowedFoods.length !== foodIds.length) {
        throw new ApiException({
          code: 'NOT_FOUND',
          message: 'Alimento não encontrado',
          request_id: '',
        })
      }
    }

    const newPlanId = await db.transaction(async (tx) => {
      // Marca parent inactive
      await tx
        .update(mealPlans)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(mealPlans.id, parent.id))

      const [planRow] = await tx
        .insert(mealPlans)
        .values({
          tenantId,
          memberId: parent.memberId,
          name: parsed.name,
          goal: parsed.goal,
          targetKcal: parsed.targetKcal ?? null,
          targetProteinG: parsed.targetProteinG?.toString() ?? null,
          targetCarbG: parsed.targetCarbG?.toString() ?? null,
          targetLipidG: parsed.targetLipidG?.toString() ?? null,
          notes: parsed.notes ?? null,
          version: parent.version + 1,
          parentMealPlanId: parent.id,
          active: true,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: mealPlans.id })
      const pId = planRow!.id

      for (const meal of parsed.meals) {
        const [mealRow] = await tx
          .insert(mealPlanMeals)
          .values({
            tenantId,
            mealPlanId: pId,
            name: meal.name,
            expectedTime: meal.expectedTime ?? null,
            order: meal.order,
            notes: meal.notes ?? null,
          })
          .returning({ id: mealPlanMeals.id })
        const mId = mealRow!.id

        if (meal.items.length > 0) {
          await tx.insert(mealItems).values(
            meal.items.map((it) => ({
              tenantId,
              mealId: mId,
              foodId: it.foodId,
              grams: it.grams.toString(),
              measure: it.measure ?? null,
              notes: it.notes ?? null,
              order: it.order,
            })),
          )
        }
      }

      return pId
    })

    setAuditResource(newPlanId, {
      parent_id: parent.id,
      new_version: parent.version + 1,
    })
    return { ok: true as const, id: newPlanId, version: parent.version + 1 }
  },
)

// ─── listSubstitutions ───────────────────────────────────────────────────

export const listSubstitutions = wrapServerAction(
  { module: 'nutri', action: 'meal_plan.substitutions' },
  async (input: z.infer<typeof ListSubstitutionsSchema>, { session }) => {
    const parsed = ListSubstitutionsSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega meal_item + food seed
    const [item] = await db
      .select({
        id: mealItems.id,
        foodId: mealItems.foodId,
        grams: mealItems.grams,
        foodName: foods.name,
        nutrients: foods.nutrients,
      })
      .from(mealItems)
      .innerJoin(foods, eq(foods.id, mealItems.foodId))
      .where(and(eq(mealItems.id, parsed.mealItemId), eq(mealItems.tenantId, tenantId)))
      .limit(1)

    if (!item) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Item não encontrado',
        request_id: '',
      })
    }

    // Equivalências (global + tenant) onde food_id_a OR food_id_b = seed
    const equivRows = await db
      .select({
        foodIdA: foodEquivalences.foodIdA,
        foodIdB: foodEquivalences.foodIdB,
        gramsA: foodEquivalences.gramsA,
        gramsB: foodEquivalences.gramsB,
        category: foodEquivalences.category,
      })
      .from(foodEquivalences)
      .where(
        and(
          or(eq(foodEquivalences.foodIdA, item.foodId), eq(foodEquivalences.foodIdB, item.foodId)),
          or(isNull(foodEquivalences.tenantId), eq(foodEquivalences.tenantId, tenantId)),
        ),
      )

    if (equivRows.length === 0) {
      return { ok: true as const, substitutions: [] }
    }

    // Carrega foods candidatos (lado oposto do seed)
    const candidateIds = Array.from(
      new Set(equivRows.map((e) => (e.foodIdA === item.foodId ? e.foodIdB : e.foodIdA))),
    )
    const candidates = await db
      .select({
        id: foods.id,
        name: foods.name,
        nutrients: foods.nutrients,
      })
      .from(foods)
      .where(
        and(
          inArray(foods.id, candidateIds),
          or(isNull(foods.tenantId), eq(foods.tenantId, tenantId)),
        ),
      )

    const candidateMap = new Map(candidates.map((c) => [c.id, c]))

    const raw: RawEquivalenceRow[] = equivRows
      .map((e) => {
        const candidateId = e.foodIdA === item.foodId ? e.foodIdB : e.foodIdA
        const cand = candidateMap.get(candidateId)
        if (!cand) return null
        return {
          foodIdA: e.foodIdA,
          foodIdB: e.foodIdB,
          gramsA: Number(e.gramsA),
          gramsB: Number(e.gramsB),
          category: e.category,
          bFoodId: cand.id,
          bFoodName: cand.name,
          bNutrients: cand.nutrients as Nutrients,
        }
      })
      .filter((x): x is RawEquivalenceRow => x !== null)

    const substitutions = rankEquivalents(
      {
        seedFoodId: item.foodId,
        seedGrams: Number(item.grams),
        seedNutrients: item.nutrients as Nutrients,
      },
      raw,
      { topN: parsed.topN },
    )

    return {
      ok: true as const,
      substitutions,
      seed: { name: item.foodName, grams: Number(item.grams) },
    }
  },
)

// ─── upsertBranding ──────────────────────────────────────────────────────

export const upsertBranding = wrapServerAction(
  {
    module: 'nutri',
    action: 'branding.upsert',
    resourceType: 'tenant_branding',
  },
  async (input: z.infer<typeof UpsertBrandingSchema>, { session, setAuditResource }) => {
    const parsed = UpsertBrandingSchema.parse(input)
    const tenantId = session.logifit.tenantId

    await db
      .insert(tenantBranding)
      .values({
        tenantId,
        logoStoragePath: parsed.logoStoragePath ?? null,
        primaryColor: parsed.primaryColor,
        logoWidthPx: parsed.logoWidthPx,
        signatureStoragePath: parsed.signatureStoragePath ?? null,
        professionalNameDefault: parsed.professionalNameDefault ?? null,
        footerText: parsed.footerText ?? null,
      })
      .onConflictDoUpdate({
        target: tenantBranding.tenantId,
        set: {
          logoStoragePath: parsed.logoStoragePath ?? null,
          primaryColor: parsed.primaryColor,
          logoWidthPx: parsed.logoWidthPx,
          signatureStoragePath: parsed.signatureStoragePath ?? null,
          professionalNameDefault: parsed.professionalNameDefault ?? null,
          footerText: parsed.footerText ?? null,
          updatedAt: new Date(),
        },
      })

    setAuditResource(tenantId, { primary_color: parsed.primaryColor })
    return { ok: true as const }
  },
)

// ─── getBranding ─────────────────────────────────────────────────────────

export const getBranding = wrapServerAction(
  { module: 'nutri', action: 'branding.read' },
  async (_input: unknown, { session }) => {
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId))
      .limit(1)
    return { ok: true as const, branding: row ?? null }
  },
)
