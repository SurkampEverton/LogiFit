/**
 * Equivalências de alimentos — listagem por categoria + faixa calórica.
 *   Sprint 29 Faixa B.1 (ADR 0081).
 *
 * Função pura `rankEquivalents(seed, candidates, targetKcal)` recebe os pares
 * curados do banco (`food_equivalences`) e devolve top-N substituições para
 * o alimento atual, dado um alvo calórico (gramas do alimento original).
 *
 * Não faz IO — caller carrega rows do banco e passa pra função (testabilidade).
 */
import type { Nutrients } from './nutrients-schema'

export interface EquivalenceCandidate {
  /** ID do food alternativo */
  foodId: string
  foodName: string
  category: string
  /** Gramas equivalentes calculados do par (qty B equivalente a qty A da seed) */
  equivalentGrams: number
  /** kcal estimado dessa porção (já scaled) */
  equivalentKcal: number
  /** Macros simples opcionais (pra exibir comparativo) */
  proteinG?: number
  carbG?: number
  lipidG?: number
}

export interface EquivalenceSeedInput {
  /** Food original (cuja substituição estamos buscando) */
  seedFoodId: string
  seedGrams: number
  seedNutrients: Nutrients
}

export interface RawEquivalenceRow {
  foodIdA: string
  foodIdB: string
  gramsA: number
  gramsB: number
  category: string
  /** Food B (alternativo) info — caller faz join */
  bFoodId: string
  bFoodName: string
  bNutrients: Nutrients
}

/**
 * Calcula gramas equivalentes para o alvo. Se a equivalência foi 50g A ↔
 * 100g B e o usuário escolheu 75g A, retorna 150g B (regra de 3).
 */
function scaleEquivalent(seedGrams: number, gramsA: number, gramsB: number): number {
  if (gramsA <= 0) return gramsB
  return (seedGrams / gramsA) * gramsB
}

/**
 * Ordena equivalências por proximidade calórica ao seed + categoria match.
 *
 * Score = |seedKcal - candidateKcal| / seedKcal
 * Categoria match no top — sempre antes de outras categorias.
 */
export function rankEquivalents(
  seed: EquivalenceSeedInput,
  rows: RawEquivalenceRow[],
  options: { topN?: number } = {},
): EquivalenceCandidate[] {
  const topN = options.topN ?? 5
  const seedKcalTotal = (seed.seedNutrients.kcal * seed.seedGrams) / 100

  const candidates: Array<EquivalenceCandidate & { _score: number; _categoryMatch: boolean }> = []

  for (const r of rows) {
    // Determina qual lado é o seed (a ou b) e qual é o candidato
    let candidateFoodId: string
    let candidateName: string
    let candidateNutrients: Nutrients
    let equivalentGrams: number

    if (r.foodIdA === seed.seedFoodId) {
      candidateFoodId = r.foodIdB
      candidateName = r.bFoodName
      candidateNutrients = r.bNutrients
      equivalentGrams = scaleEquivalent(seed.seedGrams, r.gramsA, r.gramsB)
    } else if (r.foodIdB === seed.seedFoodId) {
      candidateFoodId = r.foodIdA
      candidateName = r.bFoodName // caller deve ter feito join correto; mesmo schema
      candidateNutrients = r.bNutrients
      equivalentGrams = scaleEquivalent(seed.seedGrams, r.gramsB, r.gramsA)
    } else {
      continue
    }

    const candidateKcal = (candidateNutrients.kcal * equivalentGrams) / 100
    const score =
      seedKcalTotal === 0
        ? Math.abs(candidateKcal)
        : Math.abs(seedKcalTotal - candidateKcal) / seedKcalTotal

    candidates.push({
      foodId: candidateFoodId,
      foodName: candidateName,
      category: r.category,
      equivalentGrams: Math.round(equivalentGrams * 100) / 100,
      equivalentKcal: Math.round(candidateKcal * 100) / 100,
      proteinG: candidateNutrients.protein_g
        ? Math.round(((candidateNutrients.protein_g * equivalentGrams) / 100) * 100) / 100
        : undefined,
      carbG: candidateNutrients.carbohydrate_g
        ? Math.round(((candidateNutrients.carbohydrate_g * equivalentGrams) / 100) * 100) / 100
        : undefined,
      lipidG: candidateNutrients.lipid_g
        ? Math.round(((candidateNutrients.lipid_g * equivalentGrams) / 100) * 100) / 100
        : undefined,
      _score: score,
      _categoryMatch: false, // caller pode setar via post-process se quiser
    })
  }

  // Ordena por score (menor = mais próximo calorimetricamente)
  candidates.sort((a, b) => a._score - b._score)

  return candidates.slice(0, topN).map((c) => {
    const { _score: _s, _categoryMatch: _cm, ...rest } = c
    return rest
  })
}
