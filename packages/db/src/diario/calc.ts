/**
 * Diário alimentar — cálculo + comparação com plano.
 *   Sprint 31 Faixa B.1.
 *
 * Funções puras:
 *   - calculateDailyDiarySummary(entries) — soma macros do dia
 *   - calculateAdherence(loggedItems, plannedItems, threshold=0.8) — %
 *   - detectMealDeviation(loggedNutrition, plannedNutrition) — gap por meal
 *
 * Reusa scaleNutrientsByGrams + addNutrients da nutrients-schema (Sprint 29).
 */
import {
  addNutrients,
  scaleNutrientsByGrams,
  type Nutrients,
} from '../nutri/nutrients-schema'

// ─── DailyDiarySummary ─────────────────────────────────────────────────────

export interface LoggedFoodItem {
  foodId: string
  grams: number
  /** Nutrientes do food por 100g */
  nutrients: Nutrients
}

export interface LoggedMealEntry {
  /** Identificador da entry (uuid) */
  entryId: string
  /** Refeição categorizada */
  mealName: string
  /** Items consumidos (estruturados — texto livre não conta) */
  items: LoggedFoodItem[]
}

export interface DailyDiarySummary {
  totalKcal: number
  totalProteinG: number
  totalCarbG: number
  totalFatG: number
  mealsCount: number
  itemsCount: number
}

/**
 * Soma macros de todas as entries do dia.
 */
export function calculateDailyDiarySummary(entries: LoggedMealEntry[]): DailyDiarySummary {
  let totals: Partial<Nutrients> = {}
  let itemsCount = 0
  for (const e of entries) {
    for (const it of e.items) {
      const scaled = scaleNutrientsByGrams(it.nutrients, it.grams)
      totals = addNutrients(totals, scaled)
      itemsCount++
    }
  }
  return {
    totalKcal: round1(totals.kcal ?? 0),
    totalProteinG: round1(totals.protein_g ?? 0),
    totalCarbG: round1(totals.carbohydrate_g ?? 0),
    totalFatG: round1(totals.lipid_g ?? 0),
    mealsCount: entries.length,
    itemsCount,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ─── Adherence ─────────────────────────────────────────────────────────────

export interface PlannedFoodItem {
  /** food_id esperado no plano */
  foodId: string
  /** gramas planejadas */
  grams: number
}

export interface AdherenceResult {
  /** % geral (0-100) */
  pct: number
  /** N items do plano que bateram (≥threshold gramas) */
  matchedCount: number
  /** Total de items no plano */
  plannedCount: number
  /** Items consumidos sem correspondente no plano */
  extraCount: number
  /** Detalhe por item (pra UI mostrar) */
  perItem: Array<{
    foodId: string
    plannedGrams: number
    loggedGrams: number
    ratio: number
    matched: boolean
  }>
}

/**
 * % do plano que o paciente cumpriu. Item considerado "matched" se
 * `loggedGrams / plannedGrams ≥ threshold` (default 0.8 = 80%).
 *
 * Items consumidos mas não planejados são `extraCount` separado.
 */
export function calculateAdherence(
  logged: LoggedFoodItem[],
  planned: PlannedFoodItem[],
  threshold = 0.8,
): AdherenceResult {
  // Agrega gramas consumidas por food_id (paciente pode comer mesmo food em 2 refeições)
  const loggedByFood = new Map<string, number>()
  for (const it of logged) {
    loggedByFood.set(it.foodId, (loggedByFood.get(it.foodId) ?? 0) + it.grams)
  }

  const plannedFoodIds = new Set(planned.map((p) => p.foodId))
  let matched = 0
  const perItem: AdherenceResult['perItem'] = []
  for (const p of planned) {
    const loggedGrams = loggedByFood.get(p.foodId) ?? 0
    const ratio = p.grams > 0 ? loggedGrams / p.grams : 0
    const isMatched = ratio >= threshold
    if (isMatched) matched++
    perItem.push({
      foodId: p.foodId,
      plannedGrams: p.grams,
      loggedGrams: round1(loggedGrams),
      ratio: Math.round(ratio * 100) / 100,
      matched: isMatched,
    })
  }

  const extraCount = Array.from(loggedByFood.keys()).filter((id) => !plannedFoodIds.has(id)).length
  const pct = planned.length === 0 ? 0 : Math.round((matched / planned.length) * 100 * 100) / 100

  return {
    pct,
    matchedCount: matched,
    plannedCount: planned.length,
    extraCount,
    perItem,
  }
}

// ─── Meal deviation ────────────────────────────────────────────────────────

export interface MealNutritionTarget {
  /** Nome da refeição (Café, Almoço, etc) */
  mealName: string
  expectedKcal: number
  expectedProteinG: number
  expectedCarbG: number
  expectedFatG: number
}

export interface MealNutritionLogged {
  mealName: string
  totalKcal: number
  totalProteinG: number
  totalCarbG: number
  totalFatG: number
}

export interface MealDeviation {
  mealName: string
  expectedKcal: number
  actualKcal: number
  deltaKcal: number
  deltaPct: number
  status: 'on_target' | 'under' | 'over'
}

const TOLERANCE = 0.15 // ±15% por refeição (mais largo que o plano todo)

/**
 * Compara o que o paciente registrou vs o que o plano previa por refeição.
 */
export function detectMealDeviation(
  logged: MealNutritionLogged,
  target: MealNutritionTarget,
): MealDeviation {
  const delta = logged.totalKcal - target.expectedKcal
  const deltaPct = target.expectedKcal > 0 ? delta / target.expectedKcal : 0

  let status: MealDeviation['status'] = 'on_target'
  if (deltaPct < -TOLERANCE) status = 'under'
  else if (deltaPct > TOLERANCE) status = 'over'

  return {
    mealName: logged.mealName,
    expectedKcal: target.expectedKcal,
    actualKcal: logged.totalKcal,
    deltaKcal: round1(delta),
    deltaPct: Math.round(deltaPct * 1000) / 10,
    status,
  }
}

/**
 * Soma desvios de várias refeições; retorna lista ordenada por |delta| descendente.
 */
export function detectAllMealDeviations(
  loggedByMeal: MealNutritionLogged[],
  targetsByMeal: MealNutritionTarget[],
): MealDeviation[] {
  const targets = new Map(targetsByMeal.map((t) => [t.mealName, t]))
  const out: MealDeviation[] = []
  for (const l of loggedByMeal) {
    const t = targets.get(l.mealName)
    if (!t) {
      // Refeição registrada sem target — vira "extra"
      out.push({
        mealName: l.mealName,
        expectedKcal: 0,
        actualKcal: l.totalKcal,
        deltaKcal: l.totalKcal,
        deltaPct: 100,
        status: 'over',
      })
      continue
    }
    out.push(detectMealDeviation(l, t))
  }
  return out.sort((a, b) => Math.abs(b.deltaKcal) - Math.abs(a.deltaKcal))
}
