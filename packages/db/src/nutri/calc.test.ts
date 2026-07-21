/**
 * calc — unit tests Sprint 29 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  type MealInput,
  calculateMealNutrition,
  calculateMealPlanNutrition,
  compareAgainstTargets,
  statusEmoji,
} from './calc'
import type { Nutrients } from './nutrients-schema'
import {
  addNutrients,
  parseNutrients,
  safeParseNutrients,
  scaleNutrientsByGrams,
} from './nutrients-schema'

const ARROZ_BRANCO: Nutrients = {
  kcal: 128,
  protein_g: 2.5,
  lipid_g: 0.2,
  carbohydrate_g: 28.1,
  fiber_g: 1.6,
}

const FRANGO_PEITO: Nutrients = {
  kcal: 159,
  protein_g: 31.5,
  lipid_g: 3.0,
  carbohydrate_g: 0,
  sodium_mg: 73,
}

const SALADA: Nutrients = {
  kcal: 20,
  protein_g: 1.4,
  lipid_g: 0.2,
  carbohydrate_g: 3.7,
  fiber_g: 1.8,
  vitamin_c_mg: 22,
}

describe('NutrientsSchema — parse + safeParse', () => {
  it('aceita objeto válido completo', () => {
    const parsed = parseNutrients(ARROZ_BRANCO)
    expect(parsed.kcal).toBe(128)
    expect(parsed.protein_g).toBe(2.5)
  })

  it('aceita campos opcionais ausentes', () => {
    const r = safeParseNutrients({
      kcal: 100,
      protein_g: 2,
      lipid_g: 0.5,
      carbohydrate_g: 22,
    })
    expect(r.ok).toBe(true)
  })

  it('rejeita campo desconhecido (strict mode)', () => {
    const r = safeParseNutrients({
      kcal: 100,
      protein_g: 2,
      lipid_g: 0.5,
      carbohydrate_g: 22,
      vitamina_inventada: 999,
    })
    expect(r.ok).toBe(false)
  })

  it('rejeita kcal acima de 900 (fora faixa fisiológica)', () => {
    const r = safeParseNutrients({
      kcal: 1500,
      protein_g: 0,
      lipid_g: 100,
      carbohydrate_g: 0,
    })
    expect(r.ok).toBe(false)
  })

  it('rejeita kcal negativo', () => {
    const r = safeParseNutrients({
      kcal: -10,
      protein_g: 0,
      lipid_g: 0,
      carbohydrate_g: 0,
    })
    expect(r.ok).toBe(false)
  })
})

describe('scaleNutrientsByGrams', () => {
  it('100g do alimento = nutrients original', () => {
    const r = scaleNutrientsByGrams(ARROZ_BRANCO, 100)
    expect(r.kcal).toBe(128)
    expect(r.protein_g).toBe(2.5)
  })

  it('50g do alimento = metade dos nutrients', () => {
    const r = scaleNutrientsByGrams(ARROZ_BRANCO, 50)
    expect(r.kcal).toBe(64)
    expect(r.protein_g).toBe(1.25)
  })

  it('200g do alimento = dobro', () => {
    const r = scaleNutrientsByGrams(FRANGO_PEITO, 200)
    expect(r.kcal).toBe(318)
    expect(r.protein_g).toBe(63)
  })
})

describe('addNutrients', () => {
  it('soma campos comuns', () => {
    const r = addNutrients({ kcal: 100, protein_g: 5 }, { kcal: 50, protein_g: 3 })
    expect(r.kcal).toBe(150)
    expect(r.protein_g).toBe(8)
  })

  it('mantém campos exclusivos de um lado', () => {
    const r = addNutrients({ kcal: 100, fiber_g: 2 }, { kcal: 50, sodium_mg: 100 })
    expect(r.kcal).toBe(150)
    expect(r.fiber_g).toBe(2)
    expect(r.sodium_mg).toBe(100)
  })
})

describe('calculateMealNutrition', () => {
  it('refeição com 1 item', () => {
    const meal: MealInput = {
      mealId: 'm1',
      name: 'Almoço',
      order: 1,
      items: [{ foodId: 'f1', foodName: 'Arroz', grams: 150, nutrients: ARROZ_BRANCO }],
    }
    const r = calculateMealNutrition(meal)
    expect(r.totals.kcal).toBe(192) // 128 * 1.5
    expect(r.totalGrams).toBe(150)
    expect(r.itemsCount).toBe(1)
  })

  it('refeição com múltiplos items', () => {
    const meal: MealInput = {
      mealId: 'm1',
      name: 'Almoço',
      order: 1,
      items: [
        { foodId: 'f1', foodName: 'Arroz', grams: 150, nutrients: ARROZ_BRANCO },
        { foodId: 'f2', foodName: 'Frango', grams: 120, nutrients: FRANGO_PEITO },
        { foodId: 'f3', foodName: 'Salada', grams: 80, nutrients: SALADA },
      ],
    }
    const r = calculateMealNutrition(meal)
    // 128*1.5 + 159*1.2 + 20*0.8 = 192 + 190.8 + 16 = 398.8
    expect(r.totals.kcal).toBeCloseTo(398.8, 1)
    expect(r.itemsCount).toBe(3)
    expect(r.totalGrams).toBe(350)
  })
})

describe('calculateMealPlanNutrition', () => {
  it('plano com 3 refeições', () => {
    const meals: MealInput[] = [
      {
        mealId: 'm1',
        name: 'Café',
        order: 1,
        items: [{ foodId: 'f1', foodName: 'Pão', grams: 50, nutrients: ARROZ_BRANCO }],
      },
      {
        mealId: 'm2',
        name: 'Almoço',
        order: 2,
        items: [
          { foodId: 'f1', foodName: 'Arroz', grams: 150, nutrients: ARROZ_BRANCO },
          { foodId: 'f2', foodName: 'Frango', grams: 120, nutrients: FRANGO_PEITO },
        ],
      },
      {
        mealId: 'm3',
        name: 'Jantar',
        order: 3,
        items: [{ foodId: 'f3', foodName: 'Salada', grams: 100, nutrients: SALADA }],
      },
    ]
    const r = calculateMealPlanNutrition(meals)
    expect(r.meals).toHaveLength(3)
    expect(r.itemsCount).toBe(4)
    expect(r.totalGrams).toBe(420)
    // Sum totals: 50g*128/100 + 150g*128/100 + 120g*159/100 + 100g*20/100
    // = 64 + 192 + 190.8 + 20 = 466.8
    expect(r.totals.kcal).toBeCloseTo(466.8, 1)
  })

  it('plano respeitando order de meals', () => {
    const meals: MealInput[] = [
      {
        mealId: 'b',
        name: 'B',
        order: 2,
        items: [],
      },
      {
        mealId: 'a',
        name: 'A',
        order: 1,
        items: [],
      },
    ]
    const r = calculateMealPlanNutrition(meals)
    expect(r.meals[0]!.name).toBe('A')
    expect(r.meals[1]!.name).toBe('B')
  })
})

describe('compareAgainstTargets', () => {
  it('on_target ±10%', () => {
    const gaps = compareAgainstTargets({ kcal: 1800 }, { kcal: 1800 })
    expect(gaps[0]!.status).toBe('on_target')
  })

  it('low quando current < target * 0.9', () => {
    const gaps = compareAgainstTargets({ kcal: 1500 }, { kcal: 1800 })
    expect(gaps[0]!.status).toBe('low')
    expect(gaps[0]!.delta).toBe(-300)
  })

  it('high quando current > target * 1.1', () => {
    const gaps = compareAgainstTargets({ kcal: 2100 }, { kcal: 1800 })
    expect(gaps[0]!.status).toBe('high')
    expect(gaps[0]!.delta).toBe(300)
  })

  it('ignora targets null', () => {
    const gaps = compareAgainstTargets(
      { kcal: 1800, protein_g: 100 },
      { kcal: 1800, protein_g: null, carbohydrate_g: null, lipid_g: null },
    )
    expect(gaps.map((g) => g.key)).toEqual(['kcal'])
  })

  it('emoji por status', () => {
    expect(statusEmoji('low')).toBe('⬇️')
    expect(statusEmoji('on_target')).toBe('✅')
    expect(statusEmoji('high')).toBe('⬆️')
  })

  it('múltiplas métricas comparadas', () => {
    const gaps = compareAgainstTargets(
      { kcal: 1850, protein_g: 110, carbohydrate_g: 200, lipid_g: 60 },
      { kcal: 1800, protein_g: 120, carbohydrate_g: 200, lipid_g: 60 },
    )
    expect(gaps).toHaveLength(4)
    expect(gaps.find((g) => g.key === 'kcal')!.status).toBe('on_target')
    expect(gaps.find((g) => g.key === 'protein_g')!.status).toBe('on_target') // 110/120 = 0.92 (>0.9)
    expect(gaps.find((g) => g.key === 'carbohydrate_g')!.status).toBe('on_target')
    expect(gaps.find((g) => g.key === 'lipid_g')!.status).toBe('on_target')
  })
})
