/**
 * `@repo/cnpj` — CNPJ lookup provider abstrato (ADR 0048).
 *
 * API pública:
 *   - `lookupCnpj(cnpj, options?)` — orquestrador (cache → primary → fallback)
 *   - `refreshCnpj(cnpj)` — força re-fetch ignorando cache
 *   - Adapters individuais: `BrasilApiCnpjProvider`, `ReceitaWsCnpjProvider`
 *
 * Uso típico em Server Action:
 *   import { lookupCnpj } from '@repo/cnpj'
 *
 *   const result = await lookupCnpj(cnpjInput)
 *   if (!result.ok) return { ok: false, error: result.error }
 *   // result.data tem o shape canônico CnpjData
 */
export {
  lookupCnpj,
  refreshCnpj,
  BrasilApiCnpjProvider,
  ReceitaWsCnpjProvider,
} from './orchestrator'
export type {
  CnpjAddress,
  CnpjData,
  CnpjLookupError,
  CnpjLookupResult,
  CnpjProvider,
  CnpjSituacao,
} from './types'
export {
  cnpjAddressSchema,
  cnpjDataSchema,
  cnpjSituacaoSchema,
} from './types'
export { invalidateCache, purgeExpiredCache, readCache, writeCache } from './cache'
