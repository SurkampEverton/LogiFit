/**
 * Cache `cnpj_cache` — leitura/escrita do dado normalizado por 7 dias.
 *
 * Cache é GLOBAL (sem tenant_id) — dado público da Receita Federal.
 * Reduz ~95% dos requests aos providers free (rate-limit-friendly).
 *
 * Sprint 01a Faixa D: TTL fixo 7 dias. Sprint 02+ pode permitir TTL
 * configurável por tenant via `tenant_cnpj_settings` (raramente
 * necessário — dado muda pouco).
 */
import { eq, sql as drizzleSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { cnpjCache } from '@repo/db/schema'
import { cnpjDataSchema, type CnpjData } from './types'

const CACHE_TTL_DAYS = 7
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000

interface CacheClient {
  db: ReturnType<typeof drizzle>
  pool: Pool
}

let _client: CacheClient | null = null

/**
 * Inicializa o cache client. Em Server Actions, o pool já existe via
 * `@repo/db/client`; este wrapper permite passar conn explícito (útil pra
 * testes + workers cron).
 */
function getClient(): CacheClient {
  if (_client) return _client
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('@repo/cnpj/cache: DATABASE_URL não definido')
  }
  const pool = new Pool({ connectionString: databaseUrl })
  _client = { db: drizzle(pool), pool }
  return _client
}

/**
 * Lê cache. Retorna null se não existe ou expirou (TTL > 7d).
 * NÃO faz fetch ao provider — caller decide (orchestrator).
 */
export async function readCache(cnpj: string): Promise<CnpjData | null> {
  const { db } = getClient()
  const rows = await db.select().from(cnpjCache).where(eq(cnpjCache.cnpj, cnpj)).limit(1)
  const row = rows[0]
  if (!row) return null

  // Expirou?
  if (row.expiresAt.getTime() < Date.now()) {
    return null
  }

  // Valida shape com Zod (defesa contra cache corrompido por migration)
  const parsed = cnpjDataSchema.safeParse(row.data)
  if (!parsed.success) {
    // Cache corrompido — log + retorna null pra forçar re-fetch
    console.warn(
      `[cnpj/cache] cache corrompido pra ${cnpj}: ${parsed.error.message.slice(0, 200)}`,
    )
    return null
  }
  return parsed.data
}

/**
 * Escreve no cache (UPSERT). Idempotente — mesmo CNPJ sobrescreve.
 */
export async function writeCache(data: CnpjData): Promise<void> {
  const { db } = getClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)

  await db
    .insert(cnpjCache)
    .values({
      cnpj: data.cnpj,
      data,
      providerUsed: data.meta.providerUsed,
      situacao: data.situacao,
      fetchedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: cnpjCache.cnpj,
      set: {
        data,
        providerUsed: data.meta.providerUsed,
        situacao: data.situacao,
        fetchedAt: now,
        expiresAt,
      },
    })
}

/**
 * Força purge de uma entrada (`refreshCnpjData` Server Action chama isso
 * antes de fazer nova consulta).
 */
export async function invalidateCache(cnpj: string): Promise<void> {
  const { db } = getClient()
  await db.delete(cnpjCache).where(eq(cnpjCache.cnpj, cnpj))
}

/**
 * Helpers de admin (não-usados na Sprint 01a; deixados pra futuro):
 *   - `purgeExpiredCache()` — cron que limpa expirados (cron `daily-cleanup-cache`)
 */
export async function purgeExpiredCache(): Promise<number> {
  const { db } = getClient()
  const result = await db
    .delete(cnpjCache)
    .where(drizzleSql`${cnpjCache.expiresAt} < NOW()`)
  return result.rowCount ?? 0
}
