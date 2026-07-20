/**
 * `@repo/ai/fiscal/retencoes` — motor de retenções tributárias (ADR 0061).
 *
 * Grupo B (retenções em AP) + Grupo G (retenções em comissão/RPA).
 * Puro e determinístico — sem I/O, sem data implícita.
 */
export type {
  CappedRateRule,
  FixedRateRule,
  ProgressiveBracket,
  ProgressiveRateRule,
  RetentionInput,
  RetentionLine,
  RetentionResult,
  RetentionRule,
  TaxKind,
  TaxNatureDefinition,
} from './types'
export {
  FEDERAL_MIN_BASE_CENTS,
  findGlobalTaxNature,
  GLOBAL_TAX_NATURES,
  INSS_CEILING_CENTS_2026,
  INSS_RATE_BP,
  IRRF_BRACKETS_2026,
  TAX_TABLES_VERSION,
} from './tables'
export { calculateRetentions } from './calculate'
