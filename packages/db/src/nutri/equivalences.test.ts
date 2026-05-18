/**
 * Equivalences ranking — unit tests Sprint 29 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import type { Nutrients } from './nutrients-schema'
import { rankEquivalents, type RawEquivalenceRow } from './equivalences'

const ARROZ_BRANCO: Nutrients = {
  kcal: 128,
  protein_g: 2.5,
  lipid_g: 0.2,
  carbohydrate_g: 28.1,
}

const ARROZ_INTEGRAL: Nutrients = {
  kcal: 124,
  protein_g: 2.6,
  lipid_g: 1.0,
  carbohydrate_g: 25.8,
}

const BATATA: Nutrients = {
  kcal: 87,
  protein_g: 1.9,
  lipid_g: 0.1,
  carbohydrate_g: 20.3,
}

const MANDIOCA: Nutrients = {
  kcal: 125,
  protein_g: 0.6,
  lipid_g: 0.3,
  carbohydrate_g: 30.1,
}

describe('rankEquivalents', () => {
  it('retorna substituições ordenadas por proximidade calórica', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'arroz_branco',
        foodIdB: 'arroz_integral',
        gramsA: 100,
        gramsB: 105,
        category: 'carbo',
        bFoodId: 'arroz_integral',
        bFoodName: 'Arroz integral',
        bNutrients: ARROZ_INTEGRAL,
      },
      {
        foodIdA: 'arroz_branco',
        foodIdB: 'batata',
        gramsA: 100,
        gramsB: 150,
        category: 'carbo',
        bFoodId: 'batata',
        bFoodName: 'Batata cozida',
        bNutrients: BATATA,
      },
      {
        foodIdA: 'arroz_branco',
        foodIdB: 'mandioca',
        gramsA: 100,
        gramsB: 100,
        category: 'carbo',
        bFoodId: 'mandioca',
        bFoodName: 'Mandioca cozida',
        bNutrients: MANDIOCA,
      },
    ]
    const r = rankEquivalents(
      {
        seedFoodId: 'arroz_branco',
        seedGrams: 100,
        seedNutrients: ARROZ_BRANCO,
      },
      rows,
    )
    expect(r).toHaveLength(3)
    // Score = |seed_kcal - candidate_kcal| / seed_kcal
    // Arroz branco seed: 100g × 128/100 = 128 kcal
    // arroz_integral: 105g × 124/100 = 130.2 → score 0.0172 (mais próximo)
    // batata: 150g × 87/100 = 130.5 → score 0.0195
    // mandioca: 100g × 125/100 = 125 → score 0.0234 (mais distante)
    expect(r[0]!.foodId).toBe('arroz_integral')
    expect(r[2]!.foodId).toBe('mandioca')
  })

  it('respeita topN', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'a',
        foodIdB: 'b',
        gramsA: 100,
        gramsB: 100,
        category: 'carbo',
        bFoodId: 'b',
        bFoodName: 'B',
        bNutrients: ARROZ_INTEGRAL,
      },
      {
        foodIdA: 'a',
        foodIdB: 'c',
        gramsA: 100,
        gramsB: 100,
        category: 'carbo',
        bFoodId: 'c',
        bFoodName: 'C',
        bNutrients: BATATA,
      },
      {
        foodIdA: 'a',
        foodIdB: 'd',
        gramsA: 100,
        gramsB: 100,
        category: 'carbo',
        bFoodId: 'd',
        bFoodName: 'D',
        bNutrients: MANDIOCA,
      },
    ]
    const r = rankEquivalents(
      { seedFoodId: 'a', seedGrams: 100, seedNutrients: ARROZ_BRANCO },
      rows,
      { topN: 2 },
    )
    expect(r).toHaveLength(2)
  })

  it('escala equivalência se seedGrams difere do par', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'arroz',
        foodIdB: 'batata',
        gramsA: 100, // 100g arroz
        gramsB: 150, // ≡ 150g batata
        category: 'carbo',
        bFoodId: 'batata',
        bFoodName: 'Batata',
        bNutrients: BATATA,
      },
    ]
    // User pediu substituir 200g de arroz → deve sugerir 300g de batata (2x)
    const r = rankEquivalents(
      {
        seedFoodId: 'arroz',
        seedGrams: 200,
        seedNutrients: ARROZ_BRANCO,
      },
      rows,
    )
    expect(r[0]!.equivalentGrams).toBe(300)
  })

  it('ignora rows que não referenciam o seed', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'outro_a',
        foodIdB: 'outro_b',
        gramsA: 100,
        gramsB: 100,
        category: 'carbo',
        bFoodId: 'outro_b',
        bFoodName: 'Outro B',
        bNutrients: BATATA,
      },
    ]
    const r = rankEquivalents(
      { seedFoodId: 'arroz_branco', seedGrams: 100, seedNutrients: ARROZ_BRANCO },
      rows,
    )
    expect(r).toHaveLength(0)
  })

  it('preenche macros opcionais do candidato', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'arroz',
        foodIdB: 'batata',
        gramsA: 100,
        gramsB: 150,
        category: 'carbo',
        bFoodId: 'batata',
        bFoodName: 'Batata',
        bNutrients: BATATA,
      },
    ]
    const r = rankEquivalents(
      { seedFoodId: 'arroz', seedGrams: 100, seedNutrients: ARROZ_BRANCO },
      rows,
    )
    expect(r[0]!.proteinG).toBeCloseTo(2.85, 2) // 1.9 * 1.5
    expect(r[0]!.carbG).toBeCloseTo(30.45, 1)
  })

  it('aceita seed como foodIdB', () => {
    const rows: RawEquivalenceRow[] = [
      {
        foodIdA: 'arroz',
        foodIdB: 'batata',
        gramsA: 100,
        gramsB: 150,
        category: 'carbo',
        bFoodId: 'arroz',
        bFoodName: 'Arroz',
        bNutrients: ARROZ_BRANCO,
      },
    ]
    // Seed é "batata"; deve achar "arroz" como candidato
    const r = rankEquivalents(
      { seedFoodId: 'batata', seedGrams: 150, seedNutrients: BATATA },
      rows,
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.foodId).toBe('arroz')
    expect(r[0]!.equivalentGrams).toBe(100)
  })
})
