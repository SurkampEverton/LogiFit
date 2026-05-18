/**
 * Diário — unit tests Sprint 31 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import type { Nutrients } from '../nutri/nutrients-schema'
import {
  calculateAdherence,
  calculateDailyDiarySummary,
  detectAllMealDeviations,
  detectMealDeviation,
  type LoggedFoodItem,
  type LoggedMealEntry,
} from './calc'

const ARROZ: Nutrients = {
  kcal: 128,
  protein_g: 2.5,
  lipid_g: 0.2,
  carbohydrate_g: 28.1,
}
const FRANGO: Nutrients = {
  kcal: 159,
  protein_g: 31.5,
  lipid_g: 3.0,
  carbohydrate_g: 0,
}
const BANANA: Nutrients = {
  kcal: 98,
  protein_g: 1.3,
  lipid_g: 0.1,
  carbohydrate_g: 26.0,
}

describe('calculateDailyDiarySummary', () => {
  it('dia vazio', () => {
    const r = calculateDailyDiarySummary([])
    expect(r.totalKcal).toBe(0)
    expect(r.itemsCount).toBe(0)
    expect(r.mealsCount).toBe(0)
  })

  it('1 refeição com 1 item', () => {
    const entries: LoggedMealEntry[] = [
      {
        entryId: 'e1',
        mealName: 'almoco',
        items: [{ foodId: 'arroz', grams: 100, nutrients: ARROZ }],
      },
    ]
    const r = calculateDailyDiarySummary(entries)
    expect(r.totalKcal).toBe(128)
    expect(r.itemsCount).toBe(1)
    expect(r.mealsCount).toBe(1)
  })

  it('múltiplas refeições escala por gramas', () => {
    const entries: LoggedMealEntry[] = [
      {
        entryId: 'e1',
        mealName: 'cafe',
        items: [{ foodId: 'banana', grams: 130, nutrients: BANANA }],
      },
      {
        entryId: 'e2',
        mealName: 'almoco',
        items: [
          { foodId: 'arroz', grams: 150, nutrients: ARROZ },
          { foodId: 'frango', grams: 120, nutrients: FRANGO },
        ],
      },
    ]
    const r = calculateDailyDiarySummary(entries)
    // 130*0.98 + 150*1.28 + 120*1.59 = 127.4 + 192 + 190.8 = 510.2
    expect(r.totalKcal).toBeCloseTo(510.2, 1)
    expect(r.itemsCount).toBe(3)
    expect(r.mealsCount).toBe(2)
  })

  it('soma protein/carb/lipid', () => {
    const entries: LoggedMealEntry[] = [
      {
        entryId: 'e1',
        mealName: 'almoco',
        items: [
          { foodId: 'arroz', grams: 100, nutrients: ARROZ },
          { foodId: 'frango', grams: 100, nutrients: FRANGO },
        ],
      },
    ]
    const r = calculateDailyDiarySummary(entries)
    expect(r.totalProteinG).toBeCloseTo(34, 1) // 2.5 + 31.5
    expect(r.totalCarbG).toBeCloseTo(28.1, 1)
    expect(r.totalFatG).toBeCloseTo(3.2, 1)
  })
})

describe('calculateAdherence', () => {
  it('paciente comeu tudo igual ao planejado', () => {
    const planned = [
      { foodId: 'arroz', grams: 150 },
      { foodId: 'frango', grams: 120 },
    ]
    const logged: LoggedFoodItem[] = [
      { foodId: 'arroz', grams: 150, nutrients: ARROZ },
      { foodId: 'frango', grams: 120, nutrients: FRANGO },
    ]
    const r = calculateAdherence(logged, planned)
    expect(r.pct).toBe(100)
    expect(r.matchedCount).toBe(2)
    expect(r.extraCount).toBe(0)
  })

  it('paciente comeu 80%+ → matched', () => {
    const planned = [{ foodId: 'arroz', grams: 150 }]
    const logged: LoggedFoodItem[] = [{ foodId: 'arroz', grams: 120, nutrients: ARROZ }] // 80%
    const r = calculateAdherence(logged, planned)
    expect(r.matchedCount).toBe(1)
    expect(r.pct).toBe(100)
  })

  it('paciente comeu <80% → not matched', () => {
    const planned = [{ foodId: 'arroz', grams: 150 }]
    const logged: LoggedFoodItem[] = [{ foodId: 'arroz', grams: 100, nutrients: ARROZ }] // 67%
    const r = calculateAdherence(logged, planned)
    expect(r.matchedCount).toBe(0)
    expect(r.pct).toBe(0)
  })

  it('plano com 4 items, 3 cumpridos → 75%', () => {
    const planned = [
      { foodId: 'arroz', grams: 150 },
      { foodId: 'frango', grams: 120 },
      { foodId: 'feijao', grams: 80 },
      { foodId: 'salada', grams: 100 },
    ]
    const logged: LoggedFoodItem[] = [
      { foodId: 'arroz', grams: 150, nutrients: ARROZ },
      { foodId: 'frango', grams: 130, nutrients: FRANGO },
      { foodId: 'feijao', grams: 80, nutrients: ARROZ },
      // salada faltou
    ]
    const r = calculateAdherence(logged, planned)
    expect(r.matchedCount).toBe(3)
    expect(r.plannedCount).toBe(4)
    expect(r.pct).toBe(75)
  })

  it('items extras contam separado', () => {
    const planned = [{ foodId: 'arroz', grams: 150 }]
    const logged: LoggedFoodItem[] = [
      { foodId: 'arroz', grams: 150, nutrients: ARROZ },
      { foodId: 'pizza', grams: 200, nutrients: ARROZ }, // não previsto
    ]
    const r = calculateAdherence(logged, planned)
    expect(r.matchedCount).toBe(1)
    expect(r.extraCount).toBe(1)
  })

  it('threshold customizado', () => {
    const planned = [{ foodId: 'arroz', grams: 100 }]
    const logged: LoggedFoodItem[] = [{ foodId: 'arroz', grams: 70, nutrients: ARROZ }]
    const r05 = calculateAdherence(logged, planned, 0.5)
    expect(r05.matchedCount).toBe(1)
    const r09 = calculateAdherence(logged, planned, 0.9)
    expect(r09.matchedCount).toBe(0)
  })

  it('plano vazio retorna 0%', () => {
    const r = calculateAdherence([], [])
    expect(r.pct).toBe(0)
    expect(r.plannedCount).toBe(0)
  })

  it('agrega gramas do mesmo food em refeições diferentes', () => {
    const planned = [{ foodId: 'arroz', grams: 200 }]
    const logged: LoggedFoodItem[] = [
      { foodId: 'arroz', grams: 100, nutrients: ARROZ }, // almoço
      { foodId: 'arroz', grams: 80, nutrients: ARROZ }, // jantar = total 180 = 90%
    ]
    const r = calculateAdherence(logged, planned)
    expect(r.matchedCount).toBe(1)
    expect(r.perItem[0]!.loggedGrams).toBe(180)
  })
})

describe('detectMealDeviation', () => {
  it('dentro da tolerância ±15% → on_target', () => {
    const r = detectMealDeviation(
      { mealName: 'almoco', totalKcal: 540, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
      {
        mealName: 'almoco',
        expectedKcal: 500,
        expectedProteinG: 0,
        expectedCarbG: 0,
        expectedFatG: 0,
      },
    )
    expect(r.status).toBe('on_target')
    expect(r.deltaKcal).toBe(40)
    expect(r.deltaPct).toBe(8)
  })

  it('muito acima → over', () => {
    const r = detectMealDeviation(
      { mealName: 'almoco', totalKcal: 800, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
      {
        mealName: 'almoco',
        expectedKcal: 500,
        expectedProteinG: 0,
        expectedCarbG: 0,
        expectedFatG: 0,
      },
    )
    expect(r.status).toBe('over')
    expect(r.deltaKcal).toBe(300)
    expect(r.deltaPct).toBe(60)
  })

  it('muito abaixo → under', () => {
    const r = detectMealDeviation(
      { mealName: 'almoco', totalKcal: 300, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
      {
        mealName: 'almoco',
        expectedKcal: 500,
        expectedProteinG: 0,
        expectedCarbG: 0,
        expectedFatG: 0,
      },
    )
    expect(r.status).toBe('under')
    expect(r.deltaKcal).toBe(-200)
  })
})

describe('detectAllMealDeviations', () => {
  it('ordena por |delta| descendente', () => {
    const r = detectAllMealDeviations(
      [
        { mealName: 'cafe', totalKcal: 350, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
        { mealName: 'almoco', totalKcal: 800, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
        { mealName: 'jantar', totalKcal: 450, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
      ],
      [
        { mealName: 'cafe', expectedKcal: 300, expectedProteinG: 0, expectedCarbG: 0, expectedFatG: 0 },
        { mealName: 'almoco', expectedKcal: 500, expectedProteinG: 0, expectedCarbG: 0, expectedFatG: 0 },
        { mealName: 'jantar', expectedKcal: 400, expectedProteinG: 0, expectedCarbG: 0, expectedFatG: 0 },
      ],
    )
    expect(r[0]!.mealName).toBe('almoco') // delta 300
    expect(r[1]!.mealName).toBe('cafe') // delta 50
    expect(r[2]!.mealName).toBe('jantar') // delta 50 — empate ordem original
  })

  it('refeição registrada sem target → extra (over com expected=0)', () => {
    const r = detectAllMealDeviations(
      [
        { mealName: 'lanche_madrugada', totalKcal: 200, totalProteinG: 0, totalCarbG: 0, totalFatG: 0 },
      ],
      [],
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.status).toBe('over')
    expect(r[0]!.expectedKcal).toBe(0)
  })
})
