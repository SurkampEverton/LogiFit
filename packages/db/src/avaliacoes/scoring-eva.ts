/**
 * Scorer EVA (Escala Visual Analógica de Dor) — Sprint 12 Faixa B.
 *
 * Escala 0-10. Interpretação canônica (cf. Huskisson 1974):
 *   0       — sem dor
 *   1-3     — dor leve
 *   4-6     — dor moderada
 *   7-9     — dor intensa
 *   10      — dor insuportável / pior dor possível
 *
 * Sprint 12 MVP: apenas EVA. Sprint 12+ adiciona scorers Oswestry/DASH/SF-36/
 * Berg/Tampa/WOMAC/TUG em arquivos próprios `scoring-<name>.ts` seguindo
 * mesma interface.
 *
 * **Não classificamos como "diagnóstico"** — apenas mapeia faixas
 * canônicas. Profissional valida e registra evolução em prontuário (Sprint
 * 20 Fisio).
 */

export interface EvaScoreInput {
  /** Valor 0-10 (Likert). */
  value: number
}

export interface EvaScoreResult {
  total: number
  interpretation: {
    label: string
    severity: 'info' | 'warning' | 'danger' | 'critical'
  }
}

const EVA_BANDS: {
  range: [number, number]
  label: string
  severity: EvaScoreResult['interpretation']['severity']
}[] = [
  { range: [0, 0], label: 'sem_dor', severity: 'info' },
  { range: [1, 3], label: 'dor_leve', severity: 'info' },
  { range: [4, 6], label: 'dor_moderada', severity: 'warning' },
  { range: [7, 9], label: 'dor_intensa', severity: 'danger' },
  { range: [10, 10], label: 'dor_insuportavel', severity: 'critical' },
]

export function scoreEva(input: EvaScoreInput): EvaScoreResult | null {
  if (
    !Number.isFinite(input.value) ||
    input.value < 0 ||
    input.value > 10 ||
    !Number.isInteger(input.value)
  ) {
    return null
  }
  const band = EVA_BANDS.find(
    (b) => input.value >= b.range[0] && input.value <= b.range[1],
  )!
  return {
    total: input.value,
    interpretation: { label: band.label, severity: band.severity },
  }
}
