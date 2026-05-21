/**
 * Orquestrador CNPJ — ADR 0048.
 *
 * Fluxo:
 *   1. Valida formato (14 dígitos numéricos) — usa `parseDocument` de @repo/db
 *   2. Lê cache (`cnpj_cache`) — se hit válido (TTL 7d), retorna
 *   3. Tenta provider primário (default BrasilAPI)
 *   4. Se primário falhar com PROVIDER_DOWN ou RATE_LIMITED → fallback (ReceitaWS)
 *   5. Sucesso → escreve no cache + retorna `{ ok: true, data, fromCache: false }`
 *
 * Sprint 01a Faixa D: providers hardcoded (BrasilAPI → ReceitaWS).
 * Sprint 02+ lê `tenant_cnpj_settings.provider_primary` + `provider_fallback`
 * (default brasilapi+receitaws; tenant pode escolher cnpja se tiver API key).
 *
 * **Erros transparentes ao caller** — `CNPJ_INVALID` (formato), `CNPJ_NOT_FOUND`
 * (Receita não encontrou), `CNPJ_PROVIDER_DOWN` (após esgotar fallbacks),
 * `CNPJ_RATE_LIMITED` (todos providers em rate limit).
 */
import { parseDocument } from '@repo/db/persons'
import { BrasilApiCnpjProvider } from './brasilapi'
import { ReceitaWsCnpjProvider } from './receitaws'
import { readCache, writeCache } from './cache'
import type { CnpjData, CnpjLookupResult, CnpjProvider } from './types'

export interface LookupOptions {
  /** Força nova consulta ignorando cache (UI "atualizar dados da Receita"). */
  skipCache?: boolean
  /** Override do provider primário (default BrasilAPI). */
  primary?: CnpjProvider
  /** Override do provider fallback (default ReceitaWS). */
  fallback?: CnpjProvider | null
}

const DEFAULT_PRIMARY = new BrasilApiCnpjProvider()
const DEFAULT_FALLBACK = new ReceitaWsCnpjProvider()

export async function lookupCnpj(
  inputCnpj: string,
  options: LookupOptions = {},
): Promise<CnpjLookupResult> {
  // 1. Valida formato (também aceita formatado "12.345.678/0001-95")
  const parsed = parseDocument(inputCnpj)
  if (!parsed.ok) {
    return {
      ok: false,
      error: { code: 'CNPJ_INVALID', reason: parsed.reason },
    }
  }
  if (parsed.kind !== 'pj') {
    return {
      ok: false,
      error: { code: 'CNPJ_INVALID', reason: 'documento é CPF, não CNPJ' },
    }
  }
  const cnpj = parsed.normalized

  // 2. Cache (se não skipCache)
  if (!options.skipCache) {
    const cached = await readCache(cnpj)
    if (cached) {
      return { ok: true, data: cached, fromCache: true }
    }
  }

  // 3. Provider primário
  const primary = options.primary ?? DEFAULT_PRIMARY
  const primaryResult = await primary.lookup(cnpj)

  if (primaryResult.ok) {
    await writeCache(primaryResult.data)
    return primaryResult
  }

  // 4. Fallback — PROVIDER_DOWN, RATE_LIMITED ou NOT_FOUND.
  //    NOT_FOUND incluído porque BrasilAPI tem base incompleta pra muitas filiais
  //    (descoberto 2026-05-21 com CNPJ 33009911/0041-26 SOUZA CRUZ filial — BrasilAPI
  //    404 + ReceitaWS 200). INVALID continua sem fallback (formato é local, não provider).
  //    Custo: 1 request extra ao ReceitaWS pra cada CNPJ inexistente; mitigado por
  //    cache 7d cobrindo ~95% dos hits repetidos.
  const shouldFallback =
    primaryResult.error.code === 'CNPJ_PROVIDER_DOWN' ||
    primaryResult.error.code === 'CNPJ_RATE_LIMITED' ||
    primaryResult.error.code === 'CNPJ_NOT_FOUND'

  const fallback = options.fallback === undefined ? DEFAULT_FALLBACK : options.fallback
  if (shouldFallback && fallback) {
    const fallbackResult = await fallback.lookup(cnpj)
    if (fallbackResult.ok) {
      await writeCache(fallbackResult.data)
      return fallbackResult
    }
    // Fallback também falhou — retorna o erro do fallback (mais recente)
    return fallbackResult
  }

  return primaryResult
}

/**
 * Helper pra Server Action `refreshCnpjData(personId)` — força re-fetch
 * (não usa cache na leitura, mas escreve no cache pro próximo lookup).
 */
export async function refreshCnpj(cnpj: string): Promise<CnpjLookupResult> {
  return lookupCnpj(cnpj, { skipCache: true })
}

// Re-exports pra ergonomia
export type { CnpjData, CnpjLookupResult, CnpjProvider }
export { BrasilApiCnpjProvider, ReceitaWsCnpjProvider }
