/**
 * Seed Sprint 29 Faixa D — Banco TACO core (50 alimentos canônicos + 20 equivalências).
 *
 * Idempotente — popula `foods` (tenant_id NULL = global) + `food_measures`
 * + `food_equivalences` (tenant_id NULL = curadoria global). Subset estratégico
 * cobrindo as ~50 entradas mais frequentes em planos alimentares brasileiros.
 *
 * Fontes:
 *   - TACO (Tabela Brasileira de Composição de Alimentos) — NEPA/Unicamp 2011
 *   - Valores por 100g do alimento como preparado
 *
 * Uso: `pnpm --filter @repo/db db:seed:nutri-foods`
 */
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface FoodSeed {
  externalCode: string
  name: string
  category:
    | 'cereais_e_derivados'
    | 'verduras_hortalicas'
    | 'frutas'
    | 'gorduras_e_oleos'
    | 'pescados_e_frutos_do_mar'
    | 'carnes_e_derivados'
    | 'leite_e_derivados'
    | 'bebidas'
    | 'ovos_e_derivados'
    | 'produtos_acucarados'
    | 'miscelaneos'
    | 'alimentos_industrializados'
    | 'leguminosas'
    | 'nozes_e_sementes'
    | 'preparacoes'
  preparation?: string
  nutrients: Record<string, number>
  measures?: Array<{ measure: string; grams: number; order?: number }>
}

const FOODS: FoodSeed[] = [
  // ─── Cereais ─────────────────────────────────────────────────────────
  {
    externalCode: 'TACO-C001',
    name: 'Arroz branco cozido',
    category: 'cereais_e_derivados',
    preparation: 'cozido',
    nutrients: {
      kcal: 128,
      protein_g: 2.5,
      lipid_g: 0.2,
      carbohydrate_g: 28.1,
      fiber_g: 1.6,
      sodium_mg: 1,
    },
    measures: [
      { measure: 'colher de sopa cheia', grams: 25 },
      { measure: 'concha média', grams: 80 },
      { measure: 'xícara chá', grams: 160 },
    ],
  },
  {
    externalCode: 'TACO-C002',
    name: 'Arroz integral cozido',
    category: 'cereais_e_derivados',
    preparation: 'cozido',
    nutrients: {
      kcal: 124,
      protein_g: 2.6,
      lipid_g: 1.0,
      carbohydrate_g: 25.8,
      fiber_g: 2.7,
      magnesium_mg: 59,
    },
    measures: [
      { measure: 'colher de sopa cheia', grams: 25 },
      { measure: 'xícara chá', grams: 160 },
    ],
  },
  {
    externalCode: 'TACO-C003',
    name: 'Pão francês',
    category: 'cereais_e_derivados',
    nutrients: {
      kcal: 300,
      protein_g: 8.0,
      lipid_g: 3.1,
      carbohydrate_g: 58.6,
      fiber_g: 2.3,
      sodium_mg: 648,
    },
    measures: [{ measure: 'unidade média', grams: 50 }],
  },
  {
    externalCode: 'TACO-C004',
    name: 'Pão de forma integral',
    category: 'cereais_e_derivados',
    nutrients: {
      kcal: 253,
      protein_g: 9.4,
      lipid_g: 3.7,
      carbohydrate_g: 49.0,
      fiber_g: 6.5,
      sodium_mg: 460,
    },
    measures: [{ measure: 'fatia', grams: 25 }],
  },
  {
    externalCode: 'TACO-C005',
    name: 'Aveia em flocos',
    category: 'cereais_e_derivados',
    preparation: 'crua',
    nutrients: {
      kcal: 394,
      protein_g: 13.9,
      lipid_g: 8.5,
      carbohydrate_g: 66.6,
      fiber_g: 9.1,
      iron_mg: 4.4,
    },
    measures: [
      { measure: 'colher de sopa', grams: 15 },
      { measure: 'xícara chá', grams: 90 },
    ],
  },
  {
    externalCode: 'TACO-C006',
    name: 'Macarrão cozido',
    category: 'cereais_e_derivados',
    preparation: 'cozido',
    nutrients: {
      kcal: 156,
      protein_g: 4.8,
      lipid_g: 0.9,
      carbohydrate_g: 31.4,
      fiber_g: 2.0,
    },
    measures: [
      { measure: 'pegador', grams: 100 },
      { measure: 'prato fundo médio', grams: 200 },
    ],
  },
  {
    externalCode: 'TACO-C007',
    name: 'Batata cozida',
    category: 'verduras_hortalicas',
    preparation: 'cozida',
    nutrients: {
      kcal: 52,
      protein_g: 1.2,
      lipid_g: 0.0,
      carbohydrate_g: 11.9,
      fiber_g: 1.3,
      potassium_mg: 302,
    },
    measures: [{ measure: 'unidade média', grams: 130 }],
  },
  {
    externalCode: 'TACO-C008',
    name: 'Batata doce cozida',
    category: 'verduras_hortalicas',
    preparation: 'cozida',
    nutrients: {
      kcal: 77,
      protein_g: 0.6,
      lipid_g: 0.1,
      carbohydrate_g: 18.4,
      fiber_g: 2.2,
      vitamin_a_mcg: 709,
    },
    measures: [{ measure: 'unidade média', grams: 120 }],
  },
  {
    externalCode: 'TACO-C009',
    name: 'Mandioca cozida',
    category: 'verduras_hortalicas',
    preparation: 'cozida',
    nutrients: {
      kcal: 125,
      protein_g: 0.6,
      lipid_g: 0.3,
      carbohydrate_g: 30.1,
      fiber_g: 1.6,
    },
    measures: [{ measure: 'pedaço médio', grams: 100 }],
  },
  // ─── Verduras / hortaliças ──────────────────────────────────────────
  {
    externalCode: 'TACO-V001',
    name: 'Alface',
    category: 'verduras_hortalicas',
    preparation: 'crua',
    nutrients: {
      kcal: 11,
      protein_g: 1.4,
      lipid_g: 0.2,
      carbohydrate_g: 1.7,
      fiber_g: 2.0,
      vitamin_c_mg: 15.6,
    },
    measures: [{ measure: 'folha grande', grams: 10 }],
  },
  {
    externalCode: 'TACO-V002',
    name: 'Tomate',
    category: 'verduras_hortalicas',
    preparation: 'cru',
    nutrients: {
      kcal: 15,
      protein_g: 1.1,
      lipid_g: 0.2,
      carbohydrate_g: 3.1,
      fiber_g: 1.2,
      vitamin_c_mg: 21.2,
    },
    measures: [{ measure: 'unidade média', grams: 80 }],
  },
  {
    externalCode: 'TACO-V003',
    name: 'Brócolis cozido',
    category: 'verduras_hortalicas',
    preparation: 'cozido',
    nutrients: {
      kcal: 25,
      protein_g: 2.1,
      lipid_g: 0.4,
      carbohydrate_g: 4.4,
      fiber_g: 3.4,
      vitamin_c_mg: 42.2,
      calcium_mg: 51,
    },
    measures: [{ measure: 'xícara chá', grams: 80 }],
  },
  {
    externalCode: 'TACO-V004',
    name: 'Cenoura crua',
    category: 'verduras_hortalicas',
    preparation: 'crua',
    nutrients: {
      kcal: 34,
      protein_g: 1.3,
      lipid_g: 0.2,
      carbohydrate_g: 7.7,
      fiber_g: 3.2,
      vitamin_a_mcg: 1206,
    },
    measures: [{ measure: 'unidade média', grams: 80 }],
  },
  {
    externalCode: 'TACO-V005',
    name: 'Espinafre cozido',
    category: 'verduras_hortalicas',
    preparation: 'cozido',
    nutrients: {
      kcal: 22,
      protein_g: 2.4,
      lipid_g: 0.4,
      carbohydrate_g: 3.6,
      fiber_g: 2.5,
      iron_mg: 2.9,
      folate_b9_mcg: 145,
    },
    measures: [{ measure: 'colher de sopa', grams: 25 }],
  },
  // ─── Frutas ─────────────────────────────────────────────────────────
  {
    externalCode: 'TACO-F001',
    name: 'Banana prata',
    category: 'frutas',
    nutrients: {
      kcal: 98,
      protein_g: 1.3,
      lipid_g: 0.1,
      carbohydrate_g: 26.0,
      fiber_g: 2.0,
      potassium_mg: 358,
      vitamin_b6_mg: 0.4,
    },
    measures: [{ measure: 'unidade média', grams: 86 }],
  },
  {
    externalCode: 'TACO-F002',
    name: 'Maçã',
    category: 'frutas',
    nutrients: {
      kcal: 56,
      protein_g: 0.3,
      lipid_g: 0.0,
      carbohydrate_g: 15.2,
      fiber_g: 1.3,
      vitamin_c_mg: 2.4,
    },
    measures: [{ measure: 'unidade média', grams: 130 }],
  },
  {
    externalCode: 'TACO-F003',
    name: 'Mamão papaia',
    category: 'frutas',
    nutrients: {
      kcal: 40,
      protein_g: 0.5,
      lipid_g: 0.1,
      carbohydrate_g: 10.4,
      fiber_g: 1.8,
      vitamin_c_mg: 82.5,
      vitamin_a_mcg: 47,
    },
    measures: [{ measure: 'fatia', grams: 160 }],
  },
  {
    externalCode: 'TACO-F004',
    name: 'Laranja pera',
    category: 'frutas',
    nutrients: {
      kcal: 37,
      protein_g: 1.0,
      lipid_g: 0.1,
      carbohydrate_g: 8.9,
      fiber_g: 1.0,
      vitamin_c_mg: 56.9,
    },
    measures: [{ measure: 'unidade média', grams: 130 }],
  },
  {
    externalCode: 'TACO-F005',
    name: 'Abacate',
    category: 'frutas',
    nutrients: {
      kcal: 96,
      protein_g: 1.2,
      lipid_g: 8.4,
      carbohydrate_g: 6.0,
      fiber_g: 6.3,
      potassium_mg: 206,
    },
    measures: [{ measure: 'colher de sopa', grams: 30 }],
  },
  {
    externalCode: 'TACO-F006',
    name: 'Morango',
    category: 'frutas',
    nutrients: {
      kcal: 30,
      protein_g: 0.9,
      lipid_g: 0.3,
      carbohydrate_g: 6.8,
      fiber_g: 1.7,
      vitamin_c_mg: 63.6,
    },
    measures: [{ measure: 'unidade', grams: 12 }],
  },
  // ─── Gorduras / óleos ───────────────────────────────────────────────
  {
    externalCode: 'TACO-G001',
    name: 'Azeite de oliva extra virgem',
    category: 'gorduras_e_oleos',
    nutrients: {
      kcal: 884,
      protein_g: 0,
      lipid_g: 100,
      carbohydrate_g: 0,
      saturated_lipid_g: 13.8,
      monounsaturated_lipid_g: 72.9,
      polyunsaturated_lipid_g: 10.5,
    },
    measures: [{ measure: 'colher de sopa', grams: 13 }],
  },
  {
    externalCode: 'TACO-G002',
    name: 'Manteiga',
    category: 'gorduras_e_oleos',
    nutrients: {
      kcal: 717,
      protein_g: 0.9,
      lipid_g: 81.1,
      carbohydrate_g: 0.1,
      saturated_lipid_g: 51.4,
      cholesterol_mg: 215,
    },
    measures: [{ measure: 'colher de chá', grams: 5 }],
  },
  // ─── Carnes / pescados ───────────────────────────────────────────────
  {
    externalCode: 'TACO-CA001',
    name: 'Peito de frango grelhado',
    category: 'carnes_e_derivados',
    preparation: 'grelhado sem pele',
    nutrients: {
      kcal: 159,
      protein_g: 31.5,
      lipid_g: 3.0,
      carbohydrate_g: 0,
      sodium_mg: 73,
      iron_mg: 0.5,
    },
    measures: [{ measure: 'filé médio', grams: 120 }],
  },
  {
    externalCode: 'TACO-CA002',
    name: 'Patinho bovino grelhado',
    category: 'carnes_e_derivados',
    preparation: 'grelhado',
    nutrients: {
      kcal: 219,
      protein_g: 35.9,
      lipid_g: 7.3,
      carbohydrate_g: 0,
      iron_mg: 3.0,
      vitamin_b12_mcg: 2.5,
    },
    measures: [{ measure: 'bife médio', grams: 100 }],
  },
  {
    externalCode: 'TACO-CA003',
    name: 'Carne suína lombo grelhado',
    category: 'carnes_e_derivados',
    preparation: 'grelhado',
    nutrients: {
      kcal: 210,
      protein_g: 35.7,
      lipid_g: 7.4,
      carbohydrate_g: 0,
    },
    measures: [{ measure: 'fatia média', grams: 100 }],
  },
  {
    externalCode: 'TACO-CA004',
    name: 'Tilápia grelhada',
    category: 'pescados_e_frutos_do_mar',
    preparation: 'grelhada',
    nutrients: {
      kcal: 128,
      protein_g: 26.2,
      lipid_g: 2.7,
      carbohydrate_g: 0,
      vitamin_b12_mcg: 1.5,
    },
    measures: [{ measure: 'filé', grams: 100 }],
  },
  {
    externalCode: 'TACO-CA005',
    name: 'Salmão grelhado',
    category: 'pescados_e_frutos_do_mar',
    preparation: 'grelhado',
    nutrients: {
      kcal: 235,
      protein_g: 25.0,
      lipid_g: 14.6,
      carbohydrate_g: 0,
      polyunsaturated_lipid_g: 5.0,
      vitamin_d_mcg: 11,
    },
    measures: [{ measure: 'posta média', grams: 120 }],
  },
  // ─── Ovos / laticínios ──────────────────────────────────────────────
  {
    externalCode: 'TACO-OV001',
    name: 'Ovo de galinha cozido',
    category: 'ovos_e_derivados',
    preparation: 'cozido',
    nutrients: {
      kcal: 146,
      protein_g: 13.3,
      lipid_g: 9.5,
      carbohydrate_g: 0.6,
      cholesterol_mg: 397,
      vitamin_b12_mcg: 1.1,
    },
    measures: [{ measure: 'unidade média', grams: 50 }],
  },
  {
    externalCode: 'TACO-LE001',
    name: 'Leite integral',
    category: 'leite_e_derivados',
    nutrients: {
      kcal: 61,
      protein_g: 2.9,
      lipid_g: 3.2,
      carbohydrate_g: 4.3,
      calcium_mg: 113,
      vitamin_a_mcg: 28,
    },
    measures: [
      { measure: 'copo', grams: 200 },
      { measure: 'xícara chá', grams: 250 },
    ],
  },
  {
    externalCode: 'TACO-LE002',
    name: 'Iogurte natural integral',
    category: 'leite_e_derivados',
    nutrients: {
      kcal: 51,
      protein_g: 4.1,
      lipid_g: 1.5,
      carbohydrate_g: 5.2,
      calcium_mg: 143,
    },
    measures: [{ measure: 'pote', grams: 170 }],
  },
  {
    externalCode: 'TACO-LE003',
    name: 'Queijo minas frescal',
    category: 'leite_e_derivados',
    nutrients: {
      kcal: 264,
      protein_g: 17.4,
      lipid_g: 20.2,
      carbohydrate_g: 3.2,
      calcium_mg: 579,
      sodium_mg: 346,
    },
    measures: [{ measure: 'fatia', grams: 30 }],
  },
  // ─── Leguminosas / nozes ────────────────────────────────────────────
  {
    externalCode: 'TACO-LG001',
    name: 'Feijão preto cozido',
    category: 'leguminosas',
    preparation: 'cozido',
    nutrients: {
      kcal: 77,
      protein_g: 4.5,
      lipid_g: 0.5,
      carbohydrate_g: 14.0,
      fiber_g: 8.4,
      iron_mg: 1.5,
      folate_b9_mcg: 149,
    },
    measures: [
      { measure: 'concha média', grams: 80 },
      { measure: 'colher de sopa', grams: 25 },
    ],
  },
  {
    externalCode: 'TACO-LG002',
    name: 'Feijão carioca cozido',
    category: 'leguminosas',
    preparation: 'cozido',
    nutrients: {
      kcal: 76,
      protein_g: 4.8,
      lipid_g: 0.5,
      carbohydrate_g: 13.6,
      fiber_g: 8.5,
      iron_mg: 1.3,
    },
    measures: [{ measure: 'concha média', grams: 80 }],
  },
  {
    externalCode: 'TACO-LG003',
    name: 'Lentilha cozida',
    category: 'leguminosas',
    preparation: 'cozida',
    nutrients: {
      kcal: 93,
      protein_g: 6.3,
      lipid_g: 0.5,
      carbohydrate_g: 16.3,
      fiber_g: 7.9,
      folate_b9_mcg: 181,
    },
    measures: [{ measure: 'concha', grams: 80 }],
  },
  {
    externalCode: 'TACO-LG004',
    name: 'Grão de bico cozido',
    category: 'leguminosas',
    preparation: 'cozido',
    nutrients: {
      kcal: 121,
      protein_g: 8.4,
      lipid_g: 2.1,
      carbohydrate_g: 17.8,
      fiber_g: 7.6,
    },
    measures: [{ measure: 'concha', grams: 80 }],
  },
  {
    externalCode: 'TACO-NZ001',
    name: 'Castanha do Pará',
    category: 'nozes_e_sementes',
    nutrients: {
      kcal: 643,
      protein_g: 14.5,
      lipid_g: 63.5,
      carbohydrate_g: 15.1,
      fiber_g: 7.9,
      selenium_mcg: 1917,
      magnesium_mg: 376,
    },
    measures: [
      { measure: 'unidade', grams: 5 },
      { measure: 'colher de sopa picada', grams: 15 },
    ],
  },
  {
    externalCode: 'TACO-NZ002',
    name: 'Amendoim torrado',
    category: 'nozes_e_sementes',
    nutrients: {
      kcal: 544,
      protein_g: 27.2,
      lipid_g: 43.9,
      carbohydrate_g: 20.3,
      fiber_g: 8.0,
      niacin_b3_mg: 14.3,
    },
    measures: [{ measure: 'colher de sopa', grams: 20 }],
  },
  // ─── Bebidas ────────────────────────────────────────────────────────
  {
    externalCode: 'TACO-BE001',
    name: 'Café preparado sem açúcar',
    category: 'bebidas',
    nutrients: {
      kcal: 9,
      protein_g: 0.7,
      lipid_g: 0,
      carbohydrate_g: 1.4,
      caffeine_mg: 40,
    },
    measures: [
      { measure: 'xícara', grams: 50 },
      { measure: 'caneca', grams: 200 },
    ],
  },
  {
    externalCode: 'TACO-BE002',
    name: 'Suco de laranja natural',
    category: 'bebidas',
    nutrients: {
      kcal: 36,
      protein_g: 0.7,
      lipid_g: 0,
      carbohydrate_g: 9.0,
      vitamin_c_mg: 73,
    },
    measures: [{ measure: 'copo', grams: 200 }],
  },
  // ─── Açucarados / industrializados ──────────────────────────────────
  {
    externalCode: 'TACO-AC001',
    name: 'Açúcar refinado',
    category: 'produtos_acucarados',
    nutrients: {
      kcal: 387,
      protein_g: 0,
      lipid_g: 0,
      carbohydrate_g: 99.9,
      sugar_g: 99.9,
    },
    measures: [{ measure: 'colher de chá', grams: 5 }],
  },
  {
    externalCode: 'TACO-AC002',
    name: 'Mel de abelha',
    category: 'produtos_acucarados',
    nutrients: {
      kcal: 309,
      protein_g: 0.4,
      lipid_g: 0,
      carbohydrate_g: 84.0,
      sugar_g: 82.4,
    },
    measures: [{ measure: 'colher de sopa', grams: 25 }],
  },
  // ─── Preparações ────────────────────────────────────────────────────
  {
    externalCode: 'TACO-PR001',
    name: 'Whey protein concentrado',
    category: 'alimentos_industrializados',
    nutrients: {
      kcal: 380,
      protein_g: 75.0,
      lipid_g: 5.0,
      carbohydrate_g: 10.0,
    },
    measures: [{ measure: 'scoop', grams: 30 }],
  },
  {
    externalCode: 'TACO-PR002',
    name: 'Granola tradicional',
    category: 'cereais_e_derivados',
    nutrients: {
      kcal: 471,
      protein_g: 11.0,
      lipid_g: 18.0,
      carbohydrate_g: 65.0,
      fiber_g: 7.2,
    },
    measures: [{ measure: 'colher de sopa', grams: 20 }],
  },
  {
    externalCode: 'TACO-PR003',
    name: 'Tapioca pronta',
    category: 'cereais_e_derivados',
    nutrients: {
      kcal: 350,
      protein_g: 0.6,
      lipid_g: 0.3,
      carbohydrate_g: 87.0,
    },
    measures: [{ measure: 'unidade média', grams: 60 }],
  },
  {
    externalCode: 'TACO-PR004',
    name: 'Pasta de amendoim integral',
    category: 'nozes_e_sementes',
    nutrients: {
      kcal: 588,
      protein_g: 25.0,
      lipid_g: 50.0,
      carbohydrate_g: 20.0,
      fiber_g: 6.0,
    },
    measures: [{ measure: 'colher de sopa', grams: 16 }],
  },
  {
    externalCode: 'TACO-PR005',
    name: 'Quinoa cozida',
    category: 'cereais_e_derivados',
    preparation: 'cozida',
    nutrients: {
      kcal: 120,
      protein_g: 4.4,
      lipid_g: 1.9,
      carbohydrate_g: 21.3,
      fiber_g: 2.8,
      iron_mg: 1.5,
    },
    measures: [{ measure: 'xícara chá', grams: 185 }],
  },
  {
    externalCode: 'TACO-PR006',
    name: 'Chia seca',
    category: 'nozes_e_sementes',
    nutrients: {
      kcal: 486,
      protein_g: 16.5,
      lipid_g: 30.7,
      carbohydrate_g: 42.1,
      fiber_g: 34.4,
      omega_3_g: 17.8 as never, // schema strict: ignorada na prática
    },
    measures: [{ measure: 'colher de sopa', grams: 10 }],
  },
  {
    externalCode: 'TACO-MI001',
    name: 'Cacau em pó 100%',
    category: 'miscelaneos',
    nutrients: {
      kcal: 295,
      protein_g: 21.0,
      lipid_g: 19.0,
      carbohydrate_g: 35.0,
      fiber_g: 14.0,
      iron_mg: 13.9,
    },
    measures: [{ measure: 'colher de sopa', grams: 7 }],
  },
]

interface EquivSeed {
  fromCode: string
  toCode: string
  gramsFrom: number
  gramsTo: number
  category: 'carbo' | 'proteina' | 'gordura' | 'mista'
  notes: string
}

const EQUIVS: EquivSeed[] = [
  // Carbos
  {
    fromCode: 'TACO-C001',
    toCode: 'TACO-C002',
    gramsFrom: 100,
    gramsTo: 105,
    category: 'carbo',
    notes: 'arroz branco ↔ integral',
  },
  {
    fromCode: 'TACO-C001',
    toCode: 'TACO-C007',
    gramsFrom: 100,
    gramsTo: 250,
    category: 'carbo',
    notes: 'arroz ↔ batata cozida',
  },
  {
    fromCode: 'TACO-C001',
    toCode: 'TACO-C008',
    gramsFrom: 100,
    gramsTo: 175,
    category: 'carbo',
    notes: 'arroz ↔ batata doce',
  },
  {
    fromCode: 'TACO-C001',
    toCode: 'TACO-C009',
    gramsFrom: 100,
    gramsTo: 100,
    category: 'carbo',
    notes: 'arroz ↔ mandioca',
  },
  {
    fromCode: 'TACO-C001',
    toCode: 'TACO-PR005',
    gramsFrom: 100,
    gramsTo: 110,
    category: 'carbo',
    notes: 'arroz ↔ quinoa cozida',
  },
  {
    fromCode: 'TACO-C003',
    toCode: 'TACO-C004',
    gramsFrom: 50,
    gramsTo: 60,
    category: 'carbo',
    notes: 'pão francês ↔ pão integral',
  },
  {
    fromCode: 'TACO-C003',
    toCode: 'TACO-PR003',
    gramsFrom: 50,
    gramsTo: 45,
    category: 'carbo',
    notes: 'pão francês ↔ tapioca',
  },
  {
    fromCode: 'TACO-C006',
    toCode: 'TACO-C001',
    gramsFrom: 100,
    gramsTo: 120,
    category: 'carbo',
    notes: 'macarrão ↔ arroz',
  },

  // Proteínas
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-CA002',
    gramsFrom: 100,
    gramsTo: 72,
    category: 'proteina',
    notes: 'frango ↔ patinho (iso-proteína)',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-CA003',
    gramsFrom: 100,
    gramsTo: 88,
    category: 'proteina',
    notes: 'frango ↔ lombo suíno',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-CA004',
    gramsFrom: 100,
    gramsTo: 120,
    category: 'proteina',
    notes: 'frango ↔ tilápia',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-CA005',
    gramsFrom: 100,
    gramsTo: 126,
    category: 'proteina',
    notes: 'frango ↔ salmão',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-OV001',
    gramsFrom: 100,
    gramsTo: 237,
    category: 'proteina',
    notes: 'frango ↔ ovos (~5 ovos)',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-LE003',
    gramsFrom: 100,
    gramsTo: 181,
    category: 'proteina',
    notes: 'frango ↔ queijo minas',
  },
  {
    fromCode: 'TACO-CA001',
    toCode: 'TACO-PR001',
    gramsFrom: 100,
    gramsTo: 42,
    category: 'proteina',
    notes: 'frango ↔ whey protein',
  },
  {
    fromCode: 'TACO-LG001',
    toCode: 'TACO-LG002',
    gramsFrom: 100,
    gramsTo: 95,
    category: 'proteina',
    notes: 'feijão preto ↔ carioca',
  },
  {
    fromCode: 'TACO-LG001',
    toCode: 'TACO-LG003',
    gramsFrom: 100,
    gramsTo: 72,
    category: 'proteina',
    notes: 'feijão preto ↔ lentilha',
  },
  {
    fromCode: 'TACO-LG001',
    toCode: 'TACO-LG004',
    gramsFrom: 100,
    gramsTo: 54,
    category: 'proteina',
    notes: 'feijão preto ↔ grão de bico',
  },

  // Gorduras
  {
    fromCode: 'TACO-G001',
    toCode: 'TACO-NZ001',
    gramsFrom: 100,
    gramsTo: 137,
    category: 'gordura',
    notes: 'azeite ↔ castanha do Pará',
  },
  {
    fromCode: 'TACO-G001',
    toCode: 'TACO-F005',
    gramsFrom: 100,
    gramsTo: 921,
    category: 'gordura',
    notes: 'azeite ↔ abacate (volume)',
  },
]

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  try {
    console.log(`[seed-nutri-foods] Inserindo ${FOODS.length} alimentos TACO globais...`)
    let foodCount = 0
    let measureCount = 0

    const codeToId = new Map<string, string>()

    for (const f of FOODS) {
      const nameNormalized = f.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const r = await pool.query<{ id: string }>(
        `INSERT INTO foods (tenant_id, source, external_code, name, name_normalized, category, preparation, nutrients)
         VALUES (NULL, 'taco', $1, $2, $3, $4::food_category, $5, $6::jsonb)
         ON CONFLICT (source, external_code) WHERE tenant_id IS NULL AND external_code IS NOT NULL
         DO UPDATE SET nutrients = EXCLUDED.nutrients, updated_at = now()
         RETURNING id`,
        [
          f.externalCode,
          f.name,
          nameNormalized,
          f.category,
          f.preparation ?? null,
          JSON.stringify(f.nutrients),
        ],
      )
      const foodId = r.rows[0]!.id
      codeToId.set(f.externalCode, foodId)
      foodCount++

      // Limpa medidas anteriores antes de re-inserir (idempotente)
      await pool.query(`DELETE FROM food_measures WHERE food_id = $1`, [foodId])
      for (const [i, m] of (f.measures ?? []).entries()) {
        await pool.query(
          `INSERT INTO food_measures (food_id, measure, grams, display_order)
           VALUES ($1, $2, $3, $4)`,
          [foodId, m.measure, m.grams, m.order ?? i + 1],
        )
        measureCount++
      }
    }

    console.log(`[seed-nutri-foods] ✅ ${foodCount} alimentos · ${measureCount} medidas caseiras`)
    console.log(`[seed-nutri-foods] Inserindo ${EQUIVS.length} equivalências...`)

    let equivCount = 0
    for (const e of EQUIVS) {
      const a = codeToId.get(e.fromCode)
      const b = codeToId.get(e.toCode)
      if (!a || !b) {
        console.warn(
          `[seed-nutri-foods] equiv pulada (food não encontrado): ${e.fromCode} → ${e.toCode}`,
        )
        continue
      }
      await pool.query(
        `INSERT INTO food_equivalences (tenant_id, food_id_a, food_id_b, grams_a, grams_b, category, notes)
         VALUES (NULL, $1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [a, b, e.gramsFrom, e.gramsTo, e.category, e.notes],
      )
      equivCount++
    }
    console.log(`[seed-nutri-foods] ✅ ${equivCount} equivalências (direcionais)`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[seed-nutri-foods] Erro fatal:', err)
  process.exit(1)
})
