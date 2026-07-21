/**
 * Nutrients schema — Sprint 29 Faixa B.1 (ADR 0080).
 *
 * Zod schema dos 30+ campos canônicos do jsonb `foods.nutrients`. Todos os
 * valores são por **100 g** do alimento (base TACO).
 *
 * Faixas fisiológicas:
 *   - kcal: 0–900 (azeite ~884, manteiga ~717, gorduras puras topam)
 *   - protein/lipid/carb: 0–100g por 100g
 *   - micros: variados (ver doc TACO 2011)
 *
 * **Strict mode**: campos não-listados são rejeitados — força consistência
 * cross-source (TACO/USDA/custom). Sprint 29b adiciona campos opcionais
 * conforme demanda real.
 */
import { z } from 'zod'

/** Schema dos nutrientes. Tudo opcional (TACO/USDA têm cobertura variável)
 *  exceto macros core (kcal/protein/lipid/carb). */
export const NutrientsSchema = z
  .object({
    // ─── Macronutrientes (obrigatórios) ──────────────────────────────────
    kcal: z.number().min(0).max(900),
    protein_g: z.number().min(0).max(100),
    lipid_g: z.number().min(0).max(100),
    carbohydrate_g: z.number().min(0).max(100),

    // ─── Macros detalhados (opcionais) ──────────────────────────────────
    fiber_g: z.number().min(0).max(100).optional(),
    saturated_lipid_g: z.number().min(0).max(100).optional(),
    monounsaturated_lipid_g: z.number().min(0).max(100).optional(),
    polyunsaturated_lipid_g: z.number().min(0).max(100).optional(),
    cholesterol_mg: z.number().min(0).max(3000).optional(),
    sugar_g: z.number().min(0).max(100).optional(),

    // ─── Minerais ───────────────────────────────────────────────────────
    sodium_mg: z.number().min(0).max(30000).optional(),
    potassium_mg: z.number().min(0).max(5000).optional(),
    calcium_mg: z.number().min(0).max(2000).optional(),
    magnesium_mg: z.number().min(0).max(1000).optional(),
    phosphorus_mg: z.number().min(0).max(2000).optional(),
    iron_mg: z.number().min(0).max(50).optional(),
    zinc_mg: z.number().min(0).max(50).optional(),
    copper_mg: z.number().min(0).max(10).optional(),
    manganese_mg: z.number().min(0).max(20).optional(),
    selenium_mcg: z.number().min(0).max(500).optional(),
    iodine_mcg: z.number().min(0).max(2000).optional(),

    // ─── Vitaminas ──────────────────────────────────────────────────────
    vitamin_a_mcg: z.number().min(0).max(50000).optional(),
    vitamin_d_mcg: z.number().min(0).max(500).optional(),
    vitamin_e_mg: z.number().min(0).max(500).optional(),
    vitamin_k_mcg: z.number().min(0).max(5000).optional(),
    vitamin_c_mg: z.number().min(0).max(2000).optional(),
    thiamin_b1_mg: z.number().min(0).max(50).optional(),
    riboflavin_b2_mg: z.number().min(0).max(50).optional(),
    niacin_b3_mg: z.number().min(0).max(200).optional(),
    pantothenic_b5_mg: z.number().min(0).max(50).optional(),
    pyridoxine_b6_mg: z.number().min(0).max(50).optional(),
    folate_b9_mcg: z.number().min(0).max(5000).optional(),
    vitamin_b12_mcg: z.number().min(0).max(500).optional(),
    biotin_b7_mcg: z.number().min(0).max(5000).optional(),

    // ─── Hidratação ────────────────────────────────────────────────────
    water_g: z.number().min(0).max(100).optional(),

    // ─── Bioativos & outros (TACO traz alguns) ─────────────────────────
    caffeine_mg: z.number().min(0).max(2000).optional(),
    alcohol_g: z.number().min(0).max(100).optional(),
  })
  .strict()

export type Nutrients = z.infer<typeof NutrientsSchema>

/** Valida + retorna objeto tipado. Lança ZodError se inválido. */
export function parseNutrients(raw: unknown): Nutrients {
  return NutrientsSchema.parse(raw)
}

/** Validação não-throw (retorna result discriminado). */
export function safeParseNutrients(
  raw: unknown,
): { ok: true; data: Nutrients } | { ok: false; issues: string[] } {
  const r = NutrientsSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  return {
    ok: false,
    issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}

/** Soma ponderada por gramas — usada em `calculateMealNutrition`.
 *  `nutrients` é o jsonb pra 100g; `grams` é a quantidade real do item. */
export function scaleNutrientsByGrams(nutrients: Nutrients, grams: number): Nutrients {
  const factor = grams / 100
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(nutrients)) {
    if (typeof v === 'number') {
      out[k] = Math.round(v * factor * 1000) / 1000
    }
  }
  return out as Nutrients
}

/** Soma dois sets de nutrientes (todos opcionais; aceita campos parciais).
 *  Usado em `calculateMealNutrition` (acumulador). */
export function addNutrients(a: Partial<Nutrients>, b: Partial<Nutrients>): Partial<Nutrients> {
  const out: Record<string, number> = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const av = (a as Record<string, number | undefined>)[k] ?? 0
    const bv = (b as Record<string, number | undefined>)[k] ?? 0
    if (av || bv) {
      out[k] = Math.round((av + bv) * 1000) / 1000
    }
  }
  return out as Partial<Nutrients>
}
