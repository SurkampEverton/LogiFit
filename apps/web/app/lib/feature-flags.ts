/**
 * Feature flags helper — Sprint 02b7 (ADR 0098).
 *
 * Resolve flag binário on/off via `feature_flags` table + cache in-memory 60s.
 *
 * **Default fail-closed**: flag não existe no DB → `false`. Garante que
 * código novo escrito antes do seed/migration não habilita feature acidentalmente.
 *
 * **Cache process-local 60s**: trade-off MVP simples — janela de propagação
 * pequena aceitável (admin liga flag, pode levar até 60s pra todos requests
 * verem). Sprint 02b8+ promove pra Redis pub/sub se virar bottleneck em
 * deploy multi-instance.
 *
 * **Uso típico** em Server Action / Route handler:
 *
 *   import { isFeatureEnabled } from '@/app/lib/feature-flags'
 *
 *   if (!(await isFeatureEnabled('passport_signup_v1'))) {
 *     throw new ApiException({
 *       code: 'FORBIDDEN',
 *       message: 'Cadastro ainda não habilitado — peça invite à clínica.',
 *       request_id: '',
 *     })
 *   }
 */
import { pool } from '@repo/db/client'

/** TTL do cache in-memory (ms). 60s = trade-off MVP. */
const CACHE_TTL_MS = 60 * 1000

interface CacheEntry {
  enabled: boolean
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Retorna se flag `key` está ativo. `false` quando flag não existe no DB
 * (fail-closed). Cache 60s in-memory pra reduzir DB round-trip.
 *
 * Cache é process-local — em deploy multi-instance, pode haver inconsistência
 * temporária <60s. Aceitável pro MVP single-instance Oracle Cloud.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.enabled
  }

  try {
    const r = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = $1 LIMIT 1`,
      [key],
    )
    const enabled = r.rows[0]?.enabled ?? false
    cache.set(key, { enabled, fetchedAt: Date.now() })
    return enabled
  } catch (err) {
    // DB indisponível → fail-closed (false) + log estruturado.
    // Não propaga erro pro caller — feature flag não deve quebrar request.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'feature_flag_lookup_failed',
        key,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return false
  }
}

/**
 * Força refresh do cache pra uma key específica. Útil em tests OR após
 * toggle via UI admin (Sprint 02b7+) pra evitar esperar TTL.
 *
 * Sprint 02b8+ Redis pub/sub: este invalidate vira broadcast pra todos workers.
 */
export function invalidateFeatureFlag(key: string): void {
  cache.delete(key)
}

/**
 * Limpa cache inteiro. Usado em tests entre suites + reload manual
 * via UI admin "Forçar refresh" (Sprint 02b7+).
 */
export function clearFeatureFlagCache(): void {
  cache.clear()
}

/**
 * Helper convenience: lê múltiplas flags em paralelo + retorna map.
 *
 * Útil em layout/page que precisa checar N flags pra rendering condicional
 * (ex: dashboard menu items por feature).
 */
export async function getFeatureFlags(
  keys: string[],
): Promise<Record<string, boolean>> {
  const results = await Promise.all(keys.map((k) => isFeatureEnabled(k)))
  return Object.fromEntries(keys.map((k, i) => [k, results[i] ?? false]))
}
