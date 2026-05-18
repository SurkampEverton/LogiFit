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
