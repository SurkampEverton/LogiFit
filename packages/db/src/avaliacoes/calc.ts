/**
 * Calculadoras antropométricas — Sprint 12 Faixa B (ADR 0024 + ADR 0070).
 *
 * Cobre o core de composição corporal e taxa metabólica para Academia +
 * Nutri (Sprint 29 reusa). Cada função:
 *   - Recebe campos brutos das `assessment_measurements`
 *   - Retorna `{ value, classification?: string }` para gravar em
 *     `assessment_calculations`
 *   - Edge cases conservadores (idade/peso inválidos retornam null)
 *
 * **Implementadas no MVP:**
 *   - IMC + classificação OMS
 *   - Pollock 7 dobras (% gordura — Jackson-Pollock 1980)
 *   - TMB Mifflin-St Jeor (1990 — mais preciso vs Harris-Benedict)
 *   - TMB Harris-Benedict (1919 — legado, ainda usado)
 *   - TMB Katch-McArdle (usa massa magra — exige bioimpedância)
 *   - Relação cintura-quadril (RCQ) + classificação OMS
 *   - Massa magra estimada a partir do peso × % gordura
 *
 * **Adiadas Sprint 12+:** Petroski (4 dobras Brasil), Guedes (3 dobras),
 * Durnin-Womersley (4 dobras), Faulkner (4 dobras esportistas),
 * Cunningham (massa magra), Jackson-Pollock circunferências.
 */

export interface CalcResult {
  value: number
  classification?: string
}

// ─── IMC + Classificação OMS ─────────────────────────────────────────────

export interface ImcInput {
  weightKg: number
  heightCm: number
}

const IMC_BANDS: { range: [number, number]; label: string }[] = [
  { range: [0, 18.5], label: 'baixo_peso' },
  { range: [18.5, 25], label: 'normal' },
  { range: [25, 30], label: 'sobrepeso' },
  { range: [30, 35], label: 'obesidade_i' },
  { range: [35, 40], label: 'obesidade_ii' },
  { range: [40, Number.POSITIVE_INFINITY], label: 'obesidade_iii' },
]

export function calculateImc(input: ImcInput): CalcResult | null {
  if (input.weightKg <= 0 || input.heightCm <= 0) return null
  const heightM = input.heightCm / 100
  const imc = input.weightKg / (heightM * heightM)
  if (!isFinite(imc) || imc <= 0 || imc > 100) return null
  const band = IMC_BANDS.find((b) => imc >= b.range[0] && imc < b.range[1])
  return {
    value: Math.round(imc * 100) / 100,
    classification: band?.label ?? 'sem_classificacao',
  }
}

// ─── Pollock 7 dobras (% gordura) ───────────────────────────────────────
/**
 * Pollock & Jackson 1980 — fórmula 7 dobras.
 *
 * 7 pontos: tricipital, subescapular, supra-ilíaca, abdominal, peitoral,
 * axilar média, coxa.
 *
 * Densidade corporal (homens):
 *   D = 1.112 - 0.00043499 × Σ + 0.00000055 × Σ² - 0.00028826 × idade
 *
 * Densidade corporal (mulheres):
 *   D = 1.0970 - 0.00046971 × Σ + 0.00000056 × Σ² - 0.00012828 × idade
 *
 * % Gordura via Siri (1956): %G = (495 / D) − 450
 *
 * Faixas de referência (homens 20-39):
 *   <11 atlético, 11-21 saudável, 22-27 sobrepeso, >27 obesidade
 */

export interface Pollock7Input {
  /** mm; soma dos 7 sites */
  tricipital: number
  subescapular: number
  supraIliaca: number
  abdominal: number
  peitoral: number
  axilarMedia: number
  coxa: number
  ageYears: number
  sex: 'male' | 'female'
}

const POLLOCK_BANDS_MALE: { range: [number, number]; label: string }[] = [
  { range: [0, 11], label: 'atletico' },
  { range: [11, 22], label: 'saudavel' },
  { range: [22, 27], label: 'sobrepeso' },
  { range: [27, 100], label: 'obesidade' },
]

const POLLOCK_BANDS_FEMALE: { range: [number, number]; label: string }[] = [
  { range: [0, 17], label: 'atletico' },
  { range: [17, 28], label: 'saudavel' },
  { range: [28, 32], label: 'sobrepeso' },
  { range: [32, 100], label: 'obesidade' },
]

export function calculatePollock7(input: Pollock7Input): CalcResult | null {
  if (input.ageYears <= 0 || input.ageYears > 120) return null
  const sum =
    input.tricipital +
    input.subescapular +
    input.supraIliaca +
    input.abdominal +
    input.peitoral +
    input.axilarMedia +
    input.coxa
  if (sum <= 0 || sum > 500) return null

  let density: number
  if (input.sex === 'male') {
    density = 1.112 - 0.00043499 * sum + 0.00000055 * sum * sum - 0.00028826 * input.ageYears
  } else {
    density = 1.097 - 0.00046971 * sum + 0.00000056 * sum * sum - 0.00012828 * input.ageYears
  }
  if (density <= 0 || density > 1.2) return null
  const pctFat = 495 / density - 450
  if (pctFat < 0 || pctFat > 70) return null

  const bands = input.sex === 'male' ? POLLOCK_BANDS_MALE : POLLOCK_BANDS_FEMALE
  const band = bands.find((b) => pctFat >= b.range[0] && pctFat < b.range[1])
  return {
    value: Math.round(pctFat * 100) / 100,
    classification: band?.label ?? 'sem_classificacao',
  }
}

// ─── TMB Mifflin-St Jeor (1990) ──────────────────────────────────────────
/**
 * Mifflin-St Jeor 1990 — recomendada pela ADA (American Dietetic Association)
 * como mais precisa para população moderna.
 *
 * Homens:   TMB = 10 × peso + 6.25 × altura − 5 × idade + 5
 * Mulheres: TMB = 10 × peso + 6.25 × altura − 5 × idade − 161
 */

export interface TmbInput {
  weightKg: number
  heightCm: number
  ageYears: number
  sex: 'male' | 'female'
}

export function calculateTmbMifflin(input: TmbInput): CalcResult | null {
  if (input.weightKg <= 0 || input.heightCm <= 0 || input.ageYears <= 0 || input.ageYears > 120)
    return null
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears
  const tmb = input.sex === 'male' ? base + 5 : base - 161
  if (tmb < 500 || tmb > 5000) return null
  return { value: Math.round(tmb * 100) / 100 }
}

// ─── TMB Harris-Benedict (1919 revisado 1984) ────────────────────────────
/**
 * Harris-Benedict revisado por Roza & Shizgal 1984.
 *
 * Homens:   TMB = 88.362 + 13.397 × peso + 4.799 × altura − 5.677 × idade
 * Mulheres: TMB = 447.593 + 9.247 × peso + 3.098 × altura − 4.330 × idade
 */
export function calculateTmbHarrisBenedict(input: TmbInput): CalcResult | null {
  if (input.weightKg <= 0 || input.heightCm <= 0 || input.ageYears <= 0 || input.ageYears > 120)
    return null
  let tmb: number
  if (input.sex === 'male') {
    tmb = 88.362 + 13.397 * input.weightKg + 4.799 * input.heightCm - 5.677 * input.ageYears
  } else {
    tmb = 447.593 + 9.247 * input.weightKg + 3.098 * input.heightCm - 4.33 * input.ageYears
  }
  if (tmb < 500 || tmb > 5000) return null
  return { value: Math.round(tmb * 100) / 100 }
}

// ─── TMB Katch-McArdle (usa massa magra) ─────────────────────────────────
/**
 * Katch-McArdle — mais precisa quando massa magra é conhecida (bioimpedância).
 *
 * TMB = 370 + 21.6 × LBM (kg)
 *
 * Onde LBM (Lean Body Mass) = peso × (1 − %gordura/100)
 */

export interface KatchMcArdleInput {
  /** Massa magra em kg (peso × (1 - pctFat/100)) */
  leanMassKg: number
}

export function calculateTmbKatchMcArdle(input: KatchMcArdleInput): CalcResult | null {
  if (input.leanMassKg <= 0 || input.leanMassKg > 200) return null
  const tmb = 370 + 21.6 * input.leanMassKg
  if (tmb < 500 || tmb > 5000) return null
  return { value: Math.round(tmb * 100) / 100 }
}

// ─── Relação Cintura-Quadril (RCQ) ───────────────────────────────────────
/**
 * RCQ = circunferência_cintura / circunferência_quadril
 *
 * Classificação OMS (risco cardiovascular):
 *   Homens:   <0.90 baixo · 0.90-0.99 moderado · ≥1.00 alto
 *   Mulheres: <0.80 baixo · 0.80-0.84 moderado · ≥0.85 alto
 */

export interface RcqInput {
  waistCm: number
  hipCm: number
  sex: 'male' | 'female'
}

export function calculateRcq(input: RcqInput): CalcResult | null {
  if (input.waistCm <= 0 || input.hipCm <= 0) return null
  const rcq = input.waistCm / input.hipCm
  if (rcq <= 0 || rcq > 2) return null
  let classification: string
  if (input.sex === 'male') {
    classification = rcq < 0.9 ? 'baixo' : rcq < 1.0 ? 'moderado' : 'alto'
  } else {
    classification = rcq < 0.8 ? 'baixo' : rcq < 0.85 ? 'moderado' : 'alto'
  }
  return {
    value: Math.round(rcq * 100) / 100,
    classification,
  }
}

// ─── Massa magra estimada ────────────────────────────────────────────────
/**
 * LBM = peso × (1 − %gordura/100)
 *
 * Helper pra alimentar Katch-McArdle quando só temos peso + % gordura.
 */
export function calculateLeanMass(weightKg: number, pctFat: number): CalcResult | null {
  if (weightKg <= 0 || pctFat < 0 || pctFat > 70) return null
  const lbm = weightKg * (1 - pctFat / 100)
  return { value: Math.round(lbm * 100) / 100 }
}
