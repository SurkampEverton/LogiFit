/**
 * Auth rate limit — registra tentativas + decide lockout (Sprint 02b4 ADR 0094).
 *
 * Implementa regra 36 + ADR 0073 camada 2 sem depender de Redis:
 *   - **5 falhas em 15 min** (por email OU por IP) → lockout 30 min
 *   - **Captcha Turnstile** ativa após 3 falhas no IP (gate UI separado)
 *   - **Pure DB-backed** via `auth_attempts` + `auth_lockouts` Sprint 01a
 *
 * Redis self-hosted (regra 36 completa via sliding window) chega em Sprint 02b5+
 * — esta camada já cobre proteção essencial pré-Redis. Quando Redis aterrissar,
 * `evaluateLockout()` pode ser swap por consulta Redis sem mudar surface.
 *
 * **Pure functions testáveis** separadas do I/O:
 *   - `countRecentFailures(rows)` — pure: conta falhas no window
 *   - `shouldLockout(failureCount)` — pure: aplica threshold 5/15min
 *   - `recordAuthAttempt(input)` — I/O: INSERT auth_attempts
 *   - `checkAuthLockout(input)` — I/O: SELECT auth_lockouts active
 *   - `evaluateLockout(input)` — I/O: junta tudo + INSERT lockout se necessário
 *
 * Uso típico em `loginPassport`:
 *   const lockout = await checkAuthLockout({ email, ip, pool })
 *   if (lockout.locked) throw LOCKED
 *   const ok = await verifyPassword(...)
 *   await recordAuthAttempt({ email, ip, success: ok, ... })
 *   if (!ok) {
 *     const ev = await evaluateLockout({ email, ip, pool })
 *     if (ev.lockoutCreated) throw LOCKED  // primeira vez bate threshold
 *   }
 *
 * Anti-enumeration: callers devem usar mesma surface de erro
 * (`Credenciais inválidas` ou `LOCKED`) — não revela "email não existe".
 */

/** Janela de avaliação de falhas (ms). 15 min canônico ADR 0073. */
export const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000

/** Threshold de falhas que dispara lockout. 5 canônico ADR 0073. */
export const AUTH_LOCKOUT_THRESHOLD = 5

/** Duração do lockout (ms). 30 min canônico ADR 0073. */
export const AUTH_LOCKOUT_DURATION_MS = 30 * 60 * 1000

/** Threshold de falhas por IP que ativa captcha. 3 canônico ADR 0073. */
export const AUTH_CAPTCHA_THRESHOLD_IP = 3

export interface AuthAttemptRow {
  email: string | null
  ip: string
  success: boolean
  failureReason: string | null
  attemptedAt: Date
}

/**
 * Conta falhas dentro do window a partir de `now`. **Pure** — caller passa
 * rows pré-fetched (testes injetam dados sintéticos sem Postgres).
 *
 * Considera apenas `success=false` AND `attemptedAt >= now - windowMs`.
 */
export function countRecentFailures(
  rows: AuthAttemptRow[],
  now: Date = new Date(),
  windowMs: number = AUTH_FAILURE_WINDOW_MS,
): number {
  const cutoff = now.getTime() - windowMs
  let count = 0
  for (const r of rows) {
    if (!r.success && r.attemptedAt.getTime() >= cutoff) count++
  }
  return count
}

/**
 * Decide se threshold de lockout foi atingido. **Pure**.
 *
 * Lockout = falhas >= threshold (>=5 default).
 */
export function shouldLockout(
  failureCount: number,
  threshold: number = AUTH_LOCKOUT_THRESHOLD,
): boolean {
  return failureCount >= threshold
}

/**
 * Decide se captcha deve ser exigido pro IP (≥3 falhas no window). **Pure**.
 *
 * UI consulta este flag antes de mostrar form login — se true, renderiza
 * Turnstile widget e exige token pra submit.
 */
export function shouldRequireCaptcha(
  failureCountByIp: number,
  threshold: number = AUTH_CAPTCHA_THRESHOLD_IP,
): boolean {
  return failureCountByIp >= threshold
}

// ─── I/O layer ───────────────────────────────────────────────────────────

/**
 * Interface mínima do `pg.Pool` que helpers precisam — facilita injection
 * em testes sem mockar pool inteiro.
 */
export interface PoolLike {
  query<R = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
}

export interface RecordAttemptInput {
  email: string | null
  ip: string
  userAgent?: string | null
  success: boolean
  /** Reason canônico — wrong_password / mfa_failed / user_disabled / etc. */
  failureReason?: string | null
  pool: PoolLike
}

/**
 * INSERT em `auth_attempts`. Fire-and-forget tolerante — falha não bloqueia
 * login (audit é nice-to-have, segurança primária é via lockout check).
 */
export async function recordAuthAttempt(input: RecordAttemptInput): Promise<void> {
  try {
    await input.pool.query(
      `INSERT INTO auth_attempts (email, ip, user_agent, success, failure_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.email, input.ip, input.userAgent ?? null, input.success, input.failureReason ?? null],
    )
  } catch (err) {
    // Logging apenas — não propaga (não bloqueia login por audit-falha)
    console.warn(
      '[recordAuthAttempt] INSERT falhou:',
      err instanceof Error ? err.message : err,
    )
  }
}

export interface CheckLockoutInput {
  email: string | null
  ip: string
  pool: PoolLike
}

export interface CheckLockoutResult {
  /** True se há lockout ativo (lockedUntil > now) por email OR ip. */
  locked: boolean
  /** Quando o lockout expira (max entre email/ip lockouts). */
  lockedUntil: Date | null
  /** Reason do lockout mais recente. */
  reason: string | null
}

/**
 * Consulta `auth_lockouts` ativo por (email OR ip). Lockout ativo = `locked_until > now()`.
 *
 * Se ambos email e ip tem lockout ativo, retorna o que expira mais tarde.
 */
export async function checkAuthLockout(input: CheckLockoutInput): Promise<CheckLockoutResult> {
  const r = await input.pool.query<{ locked_until: Date; reason: string }>(
    `SELECT locked_until, reason
     FROM auth_lockouts
     WHERE locked_until > now()
       AND (email = $1 OR ip = $2)
     ORDER BY locked_until DESC
     LIMIT 1`,
    [input.email, input.ip],
  )
  const row = r.rows[0]
  if (!row) return { locked: false, lockedUntil: null, reason: null }
  return { locked: true, lockedUntil: row.locked_until, reason: row.reason }
}

export interface EvaluateLockoutInput {
  email: string | null
  ip: string
  pool: PoolLike
  /** Override pro window de avaliação (default 15 min). */
  windowMs?: number
  /** Override pro threshold (default 5). */
  threshold?: number
  /** Override pra duração do lockout (default 30 min). */
  lockoutDurationMs?: number
}

export interface EvaluateLockoutResult {
  /** Falhas no window por email (NULL se input.email NULL). */
  failuresByEmail: number
  /** Falhas no window por IP. */
  failuresByIp: number
  /** Se threshold foi atingido em alguma das chaves (email OR ip). */
  shouldLock: boolean
  /** Se um novo lockout foi criado nessa avaliação. */
  lockoutCreated: boolean
}

/**
 * Avalia se threshold foi atingido + cria lockout se necessário.
 *
 * Chamada APÓS recordAuthAttempt em uma falha — a tentativa atual já está
 * contada. Idempotente: se lockout ativo já existe pra mesma chave, não cria
 * outro.
 *
 * Lockout granularidade: criado por `(email, ip)` separadamente — bloqueio
 * por email (5 falhas no mesmo email de IPs diferentes = email comprometido)
 * E por IP (5 falhas no mesmo IP em emails diferentes = brute force).
 */
export async function evaluateLockout(
  input: EvaluateLockoutInput,
): Promise<EvaluateLockoutResult> {
  const windowMs = input.windowMs ?? AUTH_FAILURE_WINDOW_MS
  const threshold = input.threshold ?? AUTH_LOCKOUT_THRESHOLD
  const durationMs = input.lockoutDurationMs ?? AUTH_LOCKOUT_DURATION_MS
  const cutoff = new Date(Date.now() - windowMs)

  // Count falhas por email (se email passado) e por IP
  const [emailResult, ipResult] = await Promise.all([
    input.email
      ? input.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM auth_attempts
           WHERE email = $1 AND success = false AND attempted_at >= $2`,
          [input.email, cutoff],
        )
      : Promise.resolve({ rows: [{ count: '0' }], rowCount: 1 }),
    input.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM auth_attempts
       WHERE ip = $1 AND success = false AND attempted_at >= $2`,
      [input.ip, cutoff],
    ),
  ])

  const failuresByEmail = Number.parseInt(emailResult.rows[0]?.count ?? '0', 10)
  const failuresByIp = Number.parseInt(ipResult.rows[0]?.count ?? '0', 10)

  const shouldLock =
    shouldLockout(failuresByEmail, threshold) || shouldLockout(failuresByIp, threshold)

  if (!shouldLock) {
    return { failuresByEmail, failuresByIp, shouldLock: false, lockoutCreated: false }
  }

  // Cria lockout se não há ativo pra mesma chave (email OR ip)
  // Idempotência: ON CONFLICT seria ideal mas não há unique constraint —
  // delega pra SELECT-then-INSERT.
  const existing = await input.pool.query<{ id: string }>(
    `SELECT id FROM auth_lockouts
     WHERE locked_until > now()
       AND (email = $1 OR ip = $2)
     LIMIT 1`,
    [input.email, input.ip],
  )
  if (existing.rows.length > 0) {
    return { failuresByEmail, failuresByIp, shouldLock: true, lockoutCreated: false }
  }

  const lockedUntil = new Date(Date.now() + durationMs)
  await input.pool.query(
    `INSERT INTO auth_lockouts (email, ip, locked_until, reason)
     VALUES ($1, $2, $3, 'too_many_failures')`,
    [input.email, input.ip, lockedUntil],
  )
  return { failuresByEmail, failuresByIp, shouldLock: true, lockoutCreated: true }
}
