/**
 * `@repo/ai/fiscal/apuracao` — calculadoras puras Sprint 37a (ADR 0100).
 *
 * Exports:
 *   - Types: AggregationInput, AggregationResult, MemorialLine, FiscalTaxRegime, etc.
 *   - Tables: SIMPLES_ANEXO_III_2026, SIMPLES_ANEXO_V_2026, findSimplesBracket, etc.
 *   - Compute: calculateSimplesNacional, calculateLucroPresumido, calculateLucroReal, calculateMEI, computeAggregation
 */
export * from './types'
export * from './simples-tables'
export * from './compute'
