/**
 * auth-rate-limit — unit tests (Sprint 02b4).
 *
 * Cobertura:
 *   - Pure functions: countRecentFailures + shouldLockout + shouldRequireCaptcha
 *   - I/O: recordAuthAttempt + checkAuthLockout + evaluateLockout via PoolLike mock
 *
 * Pool mock minimal: implementa `query(sql, values)` retornando rows/rowCount
 * fixos por chamada — testes injetam respostas determinísticas.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_CAPTCHA_THRESHOLD_IP,
  AUTH_FAILURE_WINDOW_MS,
  AUTH_LOCKOUT_DURATION_MS,
  AUTH_LOCKOUT_THRESHOLD,
  type AuthAttemptRow,
  checkAuthLockout,
  countRecentFailures,
  evaluateLockout,
  type PoolLike,
  recordAuthAttempt,
  shouldLockout,
  shouldRequireCaptcha,
} from './auth-rate-limit'

function mkRow(opts: Partial<AuthAttemptRow> & { attemptedAt: Date; success: boolean }): AuthAttemptRow {
  return {
    email: opts.email ?? 'maria@example.com',
    ip: opts.ip ?? '203.0.113.5',
    success: opts.success,
    failureReason: opts.failureReason ?? null,
    attemptedAt: opts.attemptedAt,
  }
}

describe('auth-rate-limit (pure)', () => {
  describe('countRecentFailures', () => {
    const now = new Date('2026-05-19T12:00:00Z')

    it('conta apenas success=false', () => {
      const rows: AuthAttemptRow[] = [
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 60_000) }),
        mkRow({ success: true, attemptedAt: new Date(now.getTime() - 120_000) }),
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 180_000) }),
      ]
      expect(countRecentFailures(rows, now)).toBe(2)
    })

    it('ignora attempts antigos fora do window 15min', () => {
      const rows: AuthAttemptRow[] = [
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 5 * 60_000) }), // within
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 16 * 60_000) }), // outside
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 30 * 60_000) }), // outside
      ]
      expect(countRecentFailures(rows, now)).toBe(1)
    })

    it('lista vazia retorna 0', () => {
      expect(countRecentFailures([], now)).toBe(0)
    })

    it('todos success retorna 0', () => {
      const rows: AuthAttemptRow[] = [
        mkRow({ success: true, attemptedAt: new Date(now.getTime() - 60_000) }),
        mkRow({ success: true, attemptedAt: new Date(now.getTime() - 120_000) }),
      ]
      expect(countRecentFailures(rows, now)).toBe(0)
    })

    it('respeita windowMs override', () => {
      const rows: AuthAttemptRow[] = [
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 60_000) }),
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - 120_000) }),
      ]
      // Window de 90s — só 1 falha cai dentro
      expect(countRecentFailures(rows, now, 90_000)).toBe(1)
    })

    it('boundary: exatamente no cutoff conta', () => {
      const rows: AuthAttemptRow[] = [
        mkRow({ success: false, attemptedAt: new Date(now.getTime() - AUTH_FAILURE_WINDOW_MS) }),
      ]
      expect(countRecentFailures(rows, now)).toBe(1)
    })
  })

  describe('shouldLockout', () => {
    it('false abaixo do threshold', () => {
      expect(shouldLockout(0)).toBe(false)
      expect(shouldLockout(1)).toBe(false)
      expect(shouldLockout(AUTH_LOCKOUT_THRESHOLD - 1)).toBe(false)
    })

    it('true em ou acima do threshold', () => {
      expect(shouldLockout(AUTH_LOCKOUT_THRESHOLD)).toBe(true)
      expect(shouldLockout(AUTH_LOCKOUT_THRESHOLD + 10)).toBe(true)
    })

    it('respeita threshold override', () => {
      expect(shouldLockout(3, 3)).toBe(true)
      expect(shouldLockout(2, 3)).toBe(false)
    })
  })

  describe('shouldRequireCaptcha', () => {
    it('false abaixo de 3 falhas/IP', () => {
      expect(shouldRequireCaptcha(0)).toBe(false)
      expect(shouldRequireCaptcha(AUTH_CAPTCHA_THRESHOLD_IP - 1)).toBe(false)
    })

    it('true em ou acima de 3 falhas/IP', () => {
      expect(shouldRequireCaptcha(AUTH_CAPTCHA_THRESHOLD_IP)).toBe(true)
      expect(shouldRequireCaptcha(99)).toBe(true)
    })
  })
})

// ─── I/O layer (PoolLike mock) ────────────────────────────────────────────

interface PreparedResponse {
  rows: unknown[]
  rowCount: number | null
}

function makePool(responses: PreparedResponse[]): {
  pool: PoolLike
  calls: Array<{ sql: string; values: unknown[] }>
} {
  let i = 0
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const pool: PoolLike = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values: values ?? [] })
      const r = responses[i++] ?? { rows: [], rowCount: 0 }
      return r as { rows: never[]; rowCount: number | null }
    },
  }
  return { pool, calls }
}

describe('auth-rate-limit (I/O)', () => {
  describe('recordAuthAttempt', () => {
    it('INSERT com todos os campos', async () => {
      const { pool, calls } = makePool([{ rows: [], rowCount: 1 }])
      await recordAuthAttempt({
        email: 'maria@example.com',
        ip: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
        success: false,
        failureReason: 'wrong_password',
        pool,
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]!.sql).toContain('INSERT INTO auth_attempts')
      expect(calls[0]!.values).toEqual([
        'maria@example.com',
        '203.0.113.5',
        'Mozilla/5.0',
        false,
        'wrong_password',
      ])
    })

    it('userAgent + failureReason opcionais → NULL', async () => {
      const { pool, calls } = makePool([{ rows: [], rowCount: 1 }])
      await recordAuthAttempt({
        email: null,
        ip: '203.0.113.5',
        success: true,
        pool,
      })
      expect(calls[0]!.values).toEqual([null, '203.0.113.5', null, true, null])
    })

    it('falha de INSERT não propaga (tolerante)', async () => {
      const pool: PoolLike = {
        async query() {
          throw new Error('connection refused')
        },
      }
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      await expect(
        recordAuthAttempt({ email: null, ip: '1.2.3.4', success: false, pool }),
      ).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('checkAuthLockout', () => {
    it('retorna locked=false quando sem rows', async () => {
      const { pool } = makePool([{ rows: [], rowCount: 0 }])
      const r = await checkAuthLockout({ email: 'a@a.com', ip: '1.2.3.4', pool })
      expect(r.locked).toBe(false)
      expect(r.lockedUntil).toBeNull()
      expect(r.reason).toBeNull()
    })

    it('retorna locked=true com lockedUntil quando lockout ativo', async () => {
      const lockedUntil = new Date(Date.now() + 30 * 60_000)
      const { pool } = makePool([
        {
          rows: [{ locked_until: lockedUntil, reason: 'too_many_failures' }],
          rowCount: 1,
        },
      ])
      const r = await checkAuthLockout({ email: 'a@a.com', ip: '1.2.3.4', pool })
      expect(r.locked).toBe(true)
      expect(r.lockedUntil).toEqual(lockedUntil)
      expect(r.reason).toBe('too_many_failures')
    })

    it('SQL usa locked_until > now()', async () => {
      const { pool, calls } = makePool([{ rows: [], rowCount: 0 }])
      await checkAuthLockout({ email: 'a@a.com', ip: '1.2.3.4', pool })
      expect(calls[0]!.sql).toContain('locked_until > now()')
      expect(calls[0]!.sql).toContain('(email = $1 OR ip = $2)')
    })
  })

  describe('evaluateLockout', () => {
    it('abaixo do threshold → não cria lockout', async () => {
      const { pool, calls } = makePool([
        { rows: [{ count: '2' }], rowCount: 1 }, // failures by email
        { rows: [{ count: '1' }], rowCount: 1 }, // failures by ip
      ])
      const r = await evaluateLockout({
        email: 'a@a.com',
        ip: '1.2.3.4',
        pool,
      })
      expect(r.shouldLock).toBe(false)
      expect(r.lockoutCreated).toBe(false)
      expect(r.failuresByEmail).toBe(2)
      expect(r.failuresByIp).toBe(1)
      // Apenas 2 queries — não chama SELECT existing nem INSERT
      expect(calls).toHaveLength(2)
    })

    it('threshold por email → cria lockout', async () => {
      const { pool, calls } = makePool([
        { rows: [{ count: String(AUTH_LOCKOUT_THRESHOLD) }], rowCount: 1 },
        { rows: [{ count: '1' }], rowCount: 1 },
        { rows: [], rowCount: 0 }, // existing lockout: vazio
        { rows: [], rowCount: 1 }, // INSERT
      ])
      const r = await evaluateLockout({
        email: 'a@a.com',
        ip: '1.2.3.4',
        pool,
      })
      expect(r.shouldLock).toBe(true)
      expect(r.lockoutCreated).toBe(true)
      expect(r.failuresByEmail).toBe(AUTH_LOCKOUT_THRESHOLD)
      expect(calls).toHaveLength(4)
      expect(calls[3]!.sql).toContain('INSERT INTO auth_lockouts')
    })

    it('threshold por IP → cria lockout (sem email)', async () => {
      // email NULL → skip query email (inline Promise.resolve). Só 3 pool calls:
      // IP count, existing lockout check, INSERT.
      const { pool, calls } = makePool([
        { rows: [{ count: String(AUTH_LOCKOUT_THRESHOLD + 2) }], rowCount: 1 },
        { rows: [], rowCount: 0 }, // existing vazio
        { rows: [], rowCount: 1 }, // INSERT
      ])
      const r = await evaluateLockout({
        email: null,
        ip: '1.2.3.4',
        pool,
      })
      expect(r.shouldLock).toBe(true)
      expect(r.lockoutCreated).toBe(true)
      expect(r.failuresByIp).toBe(AUTH_LOCKOUT_THRESHOLD + 2)
      expect(r.failuresByEmail).toBe(0)
      // INSERT teve email=NULL
      const insertCall = calls.find((c) => c.sql.includes('INSERT INTO auth_lockouts'))
      expect(insertCall?.values[0]).toBeNull()
    })

    it('lockout ativo já existe → não duplica', async () => {
      const { pool, calls } = makePool([
        { rows: [{ count: String(AUTH_LOCKOUT_THRESHOLD) }], rowCount: 1 },
        { rows: [{ count: '1' }], rowCount: 1 },
        { rows: [{ id: 'existing-uuid' }], rowCount: 1 }, // existing lockout ativo
      ])
      const r = await evaluateLockout({
        email: 'a@a.com',
        ip: '1.2.3.4',
        pool,
      })
      expect(r.shouldLock).toBe(true)
      expect(r.lockoutCreated).toBe(false)
      // 3 queries — sem INSERT
      expect(calls).toHaveLength(3)
      expect(calls.every((c) => !c.sql.includes('INSERT INTO auth_lockouts'))).toBe(true)
    })

    it('respeita threshold override', async () => {
      const { pool } = makePool([
        { rows: [{ count: '3' }], rowCount: 1 },
        { rows: [{ count: '0' }], rowCount: 1 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 1 },
      ])
      const r = await evaluateLockout({
        email: 'a@a.com',
        ip: '1.2.3.4',
        pool,
        threshold: 3,
      })
      expect(r.shouldLock).toBe(true)
      expect(r.lockoutCreated).toBe(true)
    })

    it('respeita lockoutDurationMs override (verifica INSERT values)', async () => {
      const customDuration = 5 * 60_000
      const before = Date.now()
      const { pool, calls } = makePool([
        { rows: [{ count: String(AUTH_LOCKOUT_THRESHOLD) }], rowCount: 1 },
        { rows: [{ count: '0' }], rowCount: 1 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 1 },
      ])
      await evaluateLockout({
        email: 'a@a.com',
        ip: '1.2.3.4',
        pool,
        lockoutDurationMs: customDuration,
      })
      const insertCall = calls.find((c) => c.sql.includes('INSERT INTO auth_lockouts'))
      const lockedUntil = insertCall?.values[2] as Date
      const lockedUntilMs = lockedUntil.getTime()
      // lockedUntil deve estar ~5min no futuro (tolerância 1000ms)
      expect(lockedUntilMs).toBeGreaterThanOrEqual(before + customDuration - 1000)
      expect(lockedUntilMs).toBeLessThanOrEqual(before + customDuration + 1000)
    })
  })
})

describe('canonical constants', () => {
  it('AUTH_FAILURE_WINDOW_MS = 15 min', () => {
    expect(AUTH_FAILURE_WINDOW_MS).toBe(15 * 60 * 1000)
  })

  it('AUTH_LOCKOUT_THRESHOLD = 5', () => {
    expect(AUTH_LOCKOUT_THRESHOLD).toBe(5)
  })

  it('AUTH_LOCKOUT_DURATION_MS = 30 min', () => {
    expect(AUTH_LOCKOUT_DURATION_MS).toBe(30 * 60 * 1000)
  })

  it('AUTH_CAPTCHA_THRESHOLD_IP = 3', () => {
    expect(AUTH_CAPTCHA_THRESHOLD_IP).toBe(3)
  })
})
