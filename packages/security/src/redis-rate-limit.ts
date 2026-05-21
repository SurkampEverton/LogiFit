/**
 * Redis sliding window rate limit — regra 36 completa (Sprint 02b5 fechamento).
 *
 * Implementação sliding window via Redis ZSET (sorted set):
 *   - `ZADD key score=timestamp member=uuid` — registra falha
 *   - `ZREMRANGEBYSCORE key 0 (now - windowMs)` — purga falhas antigas
 *   - `ZCOUNT key min=cutoff max=+inf` — conta falhas no window
 *   - `EXPIRE key (windowMs + duration)` — auto-cleanup
 *
 * Vantagens sobre o SQL polling em `auth-rate-limit.ts`:
 *   - **Sub-millisecond** vs 5-30ms (Postgres query + index scan)
 *   - **Memory-only** — não cresce o `auth_attempts` table
 *   - **Sliding window real** (rolling, não buckets de 15min fixos)
 *   - **Atômico** — pipeline ZADD+ZREMRANGEBYSCORE+ZCOUNT em 1 RTT
 *
 * Coexistência com SQL polling: `auth_attempts` continua sendo o **audit
 * log** (LGPD art. 18 V, retenção 90d via cron). Redis é apenas o decisor
 * em-tempo-real. Em failure modes (Redis down/timeout), fallback SQL.
 *
 * **Connection pool**: singleton lazy via `getRedisClient()` — primeira
 * chamada conecta; subsequent reusam. Idle timeout 5min, retry strategy
 * exponencial 100ms→2s capped.
 *
 * **Chaves canônicas** (prefixadas pra namespace isolation):
 *   - `rl:auth:email:{lowercase_email}` — falhas por email
 *   - `rl:auth:ip:{ip}` — falhas por IP
 *   - `rl:lockout:email:{email}` / `rl:lockout:ip:{ip}` — flag de lockout ativo
 */
import Redis, { type Redis as RedisClient } from 'ioredis'
import {
  AUTH_FAILURE_WINDOW_MS,
  AUTH_LOCKOUT_DURATION_MS,
  AUTH_LOCKOUT_THRESHOLD,
} from './auth-rate-limit'

// ─── Cliente singleton ────────────────────────────────────────────────────

let cachedClient: RedisClient | null = null
let connectionAttempted = false

/**
 * Resolve cliente Redis lazy. Retorna `null` se REDIS_URL não setado OU
 * conexão falhou — caller deve tratar como "Redis indisponível, fallback SQL".
 *
 * Não throw — failure modes não devem bloquear login (auth-rate-limit SQL
 * continua válido).
 */
export function getRedisClient(): RedisClient | null {
  if (cachedClient) return cachedClient
  if (connectionAttempted && !cachedClient) return null // já tentou e falhou

  const url = process.env.REDIS_URL
  if (!url) {
    connectionAttempted = true
    return null
  }

  try {
    cachedClient = new Redis(url, {
      // Retry com backoff exponencial 100ms→2s cap; após 5 falhas, marca down
      retryStrategy(times: number): number | null {
        if (times > 5) return null // desiste de reconectar
        return Math.min(times * 100, 2000)
      },
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // falha imediato se offline (em vez de queue)
      lazyConnect: false,
    })

    // Marca offline em erros — caller checa isReady antes de usar
    cachedClient.on('error', (err: Error) => {
      // Loga apenas — mantém singleton (pode reconectar via retryStrategy)
      console.warn('[redis] error:', err.message)
    })

    connectionAttempted = true
    return cachedClient
  } catch (err) {
    console.warn(
      '[redis] connect failed:',
      err instanceof Error ? err.message : err,
    )
    connectionAttempted = true
    return null
  }
}

/**
 * Reseta o singleton — usado em tests pra forçar recriação após mudar env vars.
 * NÃO usar em código de produção.
 */
export function resetRedisClient(): void {
  if (cachedClient) {
    void cachedClient.quit().catch(() => {})
    cachedClient = null
  }
  connectionAttempted = false
}

// ─── Sliding window operations ────────────────────────────────────────────

/**
 * Registra uma falha de auth no sliding window + retorna count atualizado.
 *
 * Atômico via pipeline: ZADD + ZREMRANGEBYSCORE (purge antigas) + ZCOUNT
 * (count restantes) + EXPIRE (TTL = windowMs + lockoutDuration pra
 * preservar dado durante lockout).
 *
 * Retorna `null` em failure mode (Redis indisponível) — caller fallback SQL.
 */
export async function recordFailureSlidingWindow(input: {
  key: string
  /** Window de avaliação (ms) — default 15min. */
  windowMs?: number
  /** Score = timestamp da falha (ms epoch) */
  now?: Date
}): Promise<number | null> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return null

  const windowMs = input.windowMs ?? AUTH_FAILURE_WINDOW_MS
  const now = input.now?.getTime() ?? Date.now()
  const cutoff = now - windowMs
  // Member único — combina timestamp + random pra evitar colisão de ZSET
  // (ZSET de-duplica por member; se 2 falhas no mesmo ms com mesmo random, contaria 1)
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`

  try {
    const pipeline = client.pipeline()
    pipeline.zadd(input.key, now, member)
    pipeline.zremrangebyscore(input.key, 0, cutoff)
    pipeline.zcount(input.key, cutoff, '+inf')
    // TTL window + lockoutDuration pra preservar count durante lockout ativo
    pipeline.pexpire(input.key, windowMs + AUTH_LOCKOUT_DURATION_MS)
    const results = await pipeline.exec()
    if (!results) return null

    // results[2] = [error, count] do ZCOUNT
    const countResult = results[2]
    if (!countResult || countResult[0]) return null
    return typeof countResult[1] === 'number' ? countResult[1] : null
  } catch (err) {
    console.warn(
      '[redis] recordFailureSlidingWindow failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Conta falhas no window (sem registrar nova).
 *
 * Útil pra pre-check antes de tentar login (`shouldRequireCaptcha`).
 */
export async function countFailuresSlidingWindow(input: {
  key: string
  windowMs?: number
  now?: Date
}): Promise<number | null> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return null

  const windowMs = input.windowMs ?? AUTH_FAILURE_WINDOW_MS
  const now = input.now?.getTime() ?? Date.now()
  const cutoff = now - windowMs

  try {
    // Purge old + count
    const pipeline = client.pipeline()
    pipeline.zremrangebyscore(input.key, 0, cutoff)
    pipeline.zcount(input.key, cutoff, '+inf')
    const results = await pipeline.exec()
    if (!results) return null
    const countResult = results[1]
    if (!countResult || countResult[0]) return null
    return typeof countResult[1] === 'number' ? countResult[1] : null
  } catch (err) {
    console.warn(
      '[redis] countFailuresSlidingWindow failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Limpa sliding window de uma chave — usado em success login (zera contador).
 *
 * Idempotente — apaga key inteira (lazy expire substituiria mas TTL pode ser
 * longo se Redis estiver under-load).
 */
export async function clearFailuresSlidingWindow(key: string): Promise<void> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return

  try {
    await client.del(key)
  } catch (err) {
    console.warn(
      '[redis] clearFailuresSlidingWindow failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── Helpers de chaves canônicas ──────────────────────────────────────────

/**
 * Chave Redis ZSET pra falhas por email. Email lowercase pra evitar
 * `Foo@bar.com` vs `foo@bar.com` contarem separado.
 */
export function authFailuresEmailKey(email: string): string {
  return `rl:auth:email:${email.toLowerCase()}`
}

/**
 * Chave Redis ZSET pra falhas por IP.
 */
export function authFailuresIpKey(ip: string): string {
  return `rl:auth:ip:${ip}`
}

// ─── Lockout flag (chave separada pra checagem rápida) ───────────────────

/**
 * Set flag de lockout ativo no Redis com TTL = lockoutDuration.
 *
 * Quando flag presente, login bloqueado sem precisar contar falhas — read
 * O(1) vs scan ZSET. Após expiração natural (TTL), lockout sai automático.
 */
export async function setLockoutFlag(input: {
  key: string
  reason: string
  durationMs?: number
}): Promise<boolean> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return false

  const duration = input.durationMs ?? AUTH_LOCKOUT_DURATION_MS
  try {
    // SET com EX (segundos) + NX (só se não existe — idempotência)
    const result = await client.set(input.key, input.reason, 'PX', duration, 'NX')
    return result === 'OK' // 'OK' = criou agora; null = já existia
  } catch (err) {
    console.warn(
      '[redis] setLockoutFlag failed:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

/**
 * Lê flag de lockout. Retorna `reason` se ativo, null se não-ativo,
 * `undefined` se Redis indisponível (caller fallback SQL).
 */
export async function getLockoutFlag(key: string): Promise<string | null | undefined> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return undefined

  try {
    const val = await client.get(key)
    return val // string reason | null se não existe
  } catch (err) {
    console.warn(
      '[redis] getLockoutFlag failed:',
      err instanceof Error ? err.message : err,
    )
    return undefined
  }
}

/**
 * Chave de flag lockout por email.
 */
export function authLockoutEmailKey(email: string): string {
  return `rl:lockout:email:${email.toLowerCase()}`
}

/**
 * Chave de flag lockout por IP.
 */
export function authLockoutIpKey(ip: string): string {
  return `rl:lockout:ip:${ip}`
}

/**
 * Avalia lockout via Redis sliding window. Substitui `evaluateLockout` SQL
 * quando Redis disponível.
 *
 * Retorna `null` em failure mode (Redis indisponível) — caller fallback SQL.
 *
 * 1. Registra falha em (email) e (ip) ZSETs
 * 2. Se count >= threshold em qualquer um, seta flag lockout
 * 3. Retorna decisão atômica
 */
export async function evaluateLockoutRedis(input: {
  email: string | null
  ip: string
  windowMs?: number
  threshold?: number
  lockoutDurationMs?: number
}): Promise<{
  failuresByEmail: number
  failuresByIp: number
  shouldLock: boolean
  lockoutCreated: boolean
} | null> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return null

  const windowMs = input.windowMs ?? AUTH_FAILURE_WINDOW_MS
  const threshold = input.threshold ?? AUTH_LOCKOUT_THRESHOLD
  const lockoutMs = input.lockoutDurationMs ?? AUTH_LOCKOUT_DURATION_MS

  const ipKey = authFailuresIpKey(input.ip)
  const emailKey = input.email ? authFailuresEmailKey(input.email) : null

  // Registra falha em paralelo
  const [ipCount, emailCount] = await Promise.all([
    recordFailureSlidingWindow({ key: ipKey, windowMs }),
    emailKey
      ? recordFailureSlidingWindow({ key: emailKey, windowMs })
      : Promise.resolve(0),
  ])

  // Se qualquer um retornou null, falha — fallback SQL
  if (ipCount === null || emailCount === null) return null

  const shouldLock = ipCount >= threshold || emailCount >= threshold

  if (!shouldLock) {
    return {
      failuresByEmail: emailCount ?? 0,
      failuresByIp: ipCount,
      shouldLock: false,
      lockoutCreated: false,
    }
  }

  // Seta flag lockout (SET NX — idempotente)
  let lockoutCreated = false
  if (emailKey && emailCount >= threshold) {
    const created = await setLockoutFlag({
      key: authLockoutEmailKey(input.email!),
      reason: 'too_many_failures_email',
      durationMs: lockoutMs,
    })
    if (created) lockoutCreated = true
  }
  if (ipCount >= threshold) {
    const created = await setLockoutFlag({
      key: authLockoutIpKey(input.ip),
      reason: 'too_many_failures_ip',
      durationMs: lockoutMs,
    })
    if (created) lockoutCreated = true
  }

  return {
    failuresByEmail: emailCount ?? 0,
    failuresByIp: ipCount,
    shouldLock: true,
    lockoutCreated,
  }
}

/**
 * Checa lockout via Redis flags. Retorna `null` se Redis indisponível.
 *
 * Avalia (email) e (ip) flags — se qualquer um ativo, retorna lockout=true.
 */
export async function checkLockoutRedis(input: {
  email: string | null
  ip: string
}): Promise<{
  locked: boolean
  reason: string | null
} | null> {
  const client = getRedisClient()
  if (!client || client.status !== 'ready') return null

  const [emailFlag, ipFlag] = await Promise.all([
    input.email ? getLockoutFlag(authLockoutEmailKey(input.email)) : Promise.resolve(null),
    getLockoutFlag(authLockoutIpKey(input.ip)),
  ])

  // Se qualquer um retornou undefined, falha — fallback SQL
  if (emailFlag === undefined || ipFlag === undefined) return null

  if (emailFlag) return { locked: true, reason: emailFlag }
  if (ipFlag) return { locked: true, reason: ipFlag }
  return { locked: false, reason: null }
}
