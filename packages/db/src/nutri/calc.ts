/**
 * Plano alimentar — cálculo nutricional.
 *   Sprint 29 Faixa B.1 (ADR 0081).
 *
 * Funções puras:
 *   - calculateMealNutrition(items) — totals de uma refeição
 *   - calculateMealPlanNutrition(meals) — totals do plano completo + breakdown
 *   - compareAgainstTargets(totals, targets) — gap vs meta (kcal/protein/carb/lipid)
 *
 * Reusa `scaleNutrientsByGrams` + `addNutrients` de `nutrients-schema.ts`.
 */
import {
  addNutrients,
  scaleNutrientsByGrams,
  type Nutrients,
} from './nutrients-schema'

export interface MealItemInput {
  foodId: string
  foodName: string
  grams: number
  /** Nutrientes do food (por 100g) */
  nutrients: Nutrients
}

export interface MealInput {
  mealId: string
  name: string
  /** Ordem visual (usado em report) */
  order: number
  items: MealItemInput[]
}

export interface MealNutritionResult {
  mealId: string
  name: string
  totals: Partial<Nutrients>
  itemsCount: number
  totalGrams: number
}

export interface MealPlanNutritionResult {
  totals: Partial<Nutrients>
  meals: MealNutritionResult[]
  /** Soma de gramas total */
  totalGrams: number
  /** Quantidade de items no plano todo */
  itemsCount: number
}

/**
 * Total nutricional de uma refeição.
 */
export function calculateMealNutrition(meal: MealInput): MealNutritionResult {
  let totals: Partial<Nutrients> = {}
  let totalGrams = 0
  for (const item of meal.items) {
    const scaled = scaleNutrientsByGrams(item.nutrients, item.grams)
    totals = addNutrients(totals, scaled)
    totalGrams += item.grams
  }
  return {
    mealId: meal.mealId,
    name: meal.name,
    totals,
    itemsCount: meal.items.length,
    totalGrams: Math.round(totalGrams * 100) / 100,
  }
}

/**
 * Total nutricional do plano (soma de todas as refeições).
 */
export function calculateMealPlanNutrition(meals: MealInput[]): MealPlanNutritionResult {
  const orderedMeals = [...meals].sort((a, b) => a.order - b.order)
  const mealResults = orderedMeals.map(calculateMealNutrition)

  let totals: Partial<Nutrients> = {}
  let totalGrams = 0
  let itemsCount = 0
  for (const m of mealResults) {
    totals = addNutrients(totals, m.totals)
    totalGrams += m.totalGrams
    itemsCount += m.itemsCount
  }

  return {
    totals,
    meals: mealResults,
    totalGrams: Math.round(totalGrams * 100) / 100,
    itemsCount,
  }
}

// ─── Comparação com targets do plano ──────────────────────────────────────

export interface PlanTargets {
  kcal?: number | null
  protein_g?: number | null
  carbohydrate_g?: number | null
  lipid_g?: number | null
}

export interface TargetGap {
  /** Métrica */
  key: 'kcal' | 'protein_g' | 'carbohydrate_g' | 'lipid_g'
  current: number
  target: number
  /** Diferença atual - target (negativo = falta; positivo = excesso) */
  delta: number
  /** Faixa de status: 'low' < -10%, 'on_target' ±10%, 'high' > +10% */
  status: 'low' | 'on_target' | 'high'
}

const TARGET_TOLERANCE = 0.1 // ±10%

function classify(current: number, target: number): TargetGap['status'] {
  if (target <= 0) return 'on_target'
  const ratio = current / target
  if (ratio < 1 - TARGET_TOLERANCE) return 'low'
  if (ratio > 1 + TARGET_TOLERANCE) return 'high'
  return 'on_target'
}

/**
 * Compara totals do plano com targets configurados. Retorna gaps por métrica.
 * Ignora targets null/undefined.
 */
export function compareAgainstTargets(
  totals: Partial<Nutrients>,
  targets: PlanTargets,
): TargetGap[] {
  const gaps: TargetGap[] = []
  const keys: TargetGap['key'][] = ['kcal', 'protein_g', 'carbohydrate_g', 'lipid_g']
  for (const k of keys) {
    const target = targets[k] ?? null
    if (target == null) continue
    const current = (totals[k] as number | undefined) ?? 0
    gaps.push({
      key: k,
      current: Math.round(current * 100) / 100,
      target,
      delta: Math.round((current - target) * 100) / 100,
      status: classify(current, target),
    })
  }
  return gaps
}

/**
 * Helper amigável pra UI: retorna 1 emoji por status pra resumo visual.
 */
export function statusEmoji(status: TargetGap['status']): string {
  switch (status) {
    case 'low':
      return '⬇️'
    case 'on_target':
      return '✅'
    case 'high':
      return '⬆️'
  }
}
