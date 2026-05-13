/**
 * `lookupSemanticCache(query, embedding)` + `writeSemanticCache(...)` —
 * Sprint 06 Faixa B (ADR 0064).
 *
 * Threshold padrão: similarity ≥ 0.93 (cosine 1-distance). Sprint 06+ Faixa C
 * tuna empiricamente — começa conservador pra evitar falso positivo em
 * conversas com PII (member id no contexto).
 *
 * Caller fornece função `embed(text)` (resolver injeta na boot). Cache não
 * conhece o provider — só persiste embedding+text+response.
 */
import type { TenantContext } from './types'

export interface CacheEntry {
  id: string
  responseText: string
  modelSlug: string
  hits: number
  expiresAt: Date
}

export interface CacheDeps {
  /** Busca cache rows com cosine_similarity >= threshold ordenado por hits/data. */
  findSimilar(input: {
    tenantId: string
    queryEmbedding: number[]
    threshold: number
    nowIso: string
  }): Promise<CacheEntry | null>
  /** Atualiza hits/last_hit_at na cache row. */
  bumpHit(id: string): Promise<void>
  /** Insere nova entry. TTL 30d default. */
  insert(input: {
    tenantId: string
    queryText: string
    queryEmbedding: number[]
    responseText: string
    modelSlug: string
    ttlSeconds: number
  }): Promise<void>
}

export interface CacheLookupResult {
  hit: boolean
  entry?: CacheEntry
}

const DEFAULT_THRESHOLD = 0.93
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 dias

export async function lookupSemanticCache(
  input: {
    tenantCtx: TenantContext
    queryText: string
    queryEmbedding: number[]
    threshold?: number
  },
  deps: CacheDeps,
): Promise<CacheLookupResult> {
  if (!input.queryText) return { hit: false }
  const threshold = input.threshold ?? DEFAULT_THRESHOLD

  const entry = await deps.findSimilar({
    tenantId: input.tenantCtx.tenantId,
    queryEmbedding: input.queryEmbedding,
    threshold,
    nowIso: new Date().toISOString(),
  })

  if (entry) {
    await deps.bumpHit(entry.id)
    return { hit: true, entry }
  }
  return { hit: false }
}

export async function writeSemanticCache(
  input: {
    tenantCtx: TenantContext
    queryText: string
    queryEmbedding: number[]
    responseText: string
    modelSlug: string
    ttlSeconds?: number
  },
  deps: CacheDeps,
): Promise<void> {
  return deps.insert({
    tenantId: input.tenantCtx.tenantId,
    queryText: input.queryText,
    queryEmbedding: input.queryEmbedding,
    responseText: input.responseText,
    modelSlug: input.modelSlug,
    ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  })
}
