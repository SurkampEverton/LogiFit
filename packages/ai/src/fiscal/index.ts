/**
 * `@repo/ai/fiscal` — provider abstrato fiscal + CFOP resolver (Sprint 36 Faixa B.1).
 *
 * ADR 0059 Accepted (Ciclo Fiscal Focus NFe) + ADR 0076 (NFS-e Nacional complementar).
 *
 * Exports:
 *   - FiscalProvider interface + 4 tipos de input/output
 *   - MockFiscalProvider (dev/test determinístico)
 *   - resolveCfop puro + CANONICAL_CFOPS catálogo
 *
 * Sprint 36b adiciona:
 *   - FocusNfeProvider real com safeFetch (regra 37)
 *   - Payload builders por tipo (nfse.ts, nfe.ts, nfce.ts, return.ts, etc)
 *   - CBOS/CNAE resolver
 *   - resolveFiscalProvider(tenantId, credentials) factory
 */
export * from './provider'
export * from './mock'
export * from './cfop-resolver'
export * from './focus-nfe'
export * from './emissions/nfse'
export * from './emissions/nfe'
export * from './emissions/nfce'
export { centsToDecimal, bpToPercent } from './emissions/shared'

// Sprint 37a — Apuração fiscal mensal Grupo C (ADR 0100 Proposed):
//   - types: AggregationInput/Result, MemorialLine, FiscalSimplesAnexo, FiscalTaxRegime
//   - tables: SIMPLES_ANEXO_III_2026, SIMPLES_ANEXO_V_2026 + findSimplesBracket
//   - compute: calculateSimplesNacional/LucroPresumido/LucroReal/MEI + computeAggregation dispatcher
// Named export pra evitar colisão com FiscalEmissionKind do provider (Sprint 36).
export {
  // types
  type AggregationInput,
  type AggregationResult,
  type MemorialLine,
  type SimplesBracket,
  type FiscalSimplesAnexo,
  type FiscalTaxRegime,
  // tables
  SIMPLES_ANEXO_III_2026,
  SIMPLES_ANEXO_V_2026,
  SIMPLES_RBT12_CEILING_CENTS,
  MEI_VALOR_SERVICO_CENTS,
  MEI_VALOR_COMERCIO_CENTS,
  MEI_VALOR_AMBOS_CENTS,
  MEI_RBT12_CEILING_CENTS,
  LUCRO_PRESUMIDO_ATIVIDADE,
  findSimplesBracket,
  // compute
  calculateSimplesNacional,
  calculateLucroPresumido,
  calculateLucroReal,
  calculateMEI,
  computeAggregation,
} from './apuracao'
