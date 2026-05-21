import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authFailuresEmailKey,
  authFailuresIpKey,
  authLockoutEmailKey,
  authLockoutIpKey,
  checkLockoutRedis,
  clearFailuresSlidingWindow,
  countFailuresSlidingWindow,
  evaluateLockoutRedis,
  getLockoutFlag,
  getRedisClient,
  recordFailureSlidingWindow,
  resetRedisClient,
  setLockoutFlag,
} from './redis-rate-limit'

/**
 * Tests usam mock do `ioredis` — não conectam Redis real (que pode estar
 * down em CI). Validação de comportamento do client real fica pra smoke
 * test e2e (similar ao Mailhog do @repo/email).
 */
describe('redis-rate-limit', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    resetRedisClient()
    vi.resetModules()
    delete process.env.REDIS_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetRedisClient()
    vi.restoreAllMocks()
  })

  describe('getRedisClient', () => {
    it('retorna null quando REDIS_URL não setado', () => {
      const client = getRedisClient()
      expect(client).toBeNull()
    })

    it('retorna null em chamadas subsequentes (cache do attempt)', () => {
      // 1ª chamada sem REDIS_URL marca attempted
      getRedisClient()
      // 2ª chamada deve retornar null direto sem tentar conectar
      const c2 = getRedisClient()
      expect(c2).toBeNull()
    })

    it('resetRedisClient permite retry', () => {
      getRedisClient() // marca attempted
      resetRedisClient()
      // Agora pode tentar de novo (ainda sem URL, mas o flag foi resetado)
      const c2 = getRedisClient()
      expect(c2).toBeNull() // ainda null sem URL, mas chegou ao código de novo
    })
  })

  describe('chaves canônicas', () => {
    it('authFailuresEmailKey lowercase pra evitar case mismatch', () => {
      expect(authFailuresEmailKey('User@Example.COM')).toBe('rl:auth:email:user@example.com')
    })

    it('authFailuresIpKey preserva IP exato', () => {
      expect(authFailuresIpKey('192.168.1.1')).toBe('rl:auth:ip:192.168.1.1')
      expect(authFailuresIpKey('2001:db8::1')).toBe('rl:auth:ip:2001:db8::1')
    })

    it('authLockoutEmailKey lowercase', () => {
      expect(authLockoutEmailKey('FOO@BAR.com')).toBe('rl:lockout:email:foo@bar.com')
    })

    it('authLockoutIpKey', () => {
      expect(authLockoutIpKey('10.0.0.1')).toBe('rl:lockout:ip:10.0.0.1')
    })
  })

  describe('operations sem Redis disponível', () => {
    // Sem REDIS_URL → operations retornam null/undefined (caller fallback SQL)

    it('recordFailureSlidingWindow retorna null', async () => {
      const r = await recordFailureSlidingWindow({ key: 'rl:test' })
      expect(r).toBeNull()
    })

    it('countFailuresSlidingWindow retorna null', async () => {
      const r = await countFailuresSlidingWindow({ key: 'rl:test' })
      expect(r).toBeNull()
    })

    it('clearFailuresSlidingWindow não throw', async () => {
      await expect(clearFailuresSlidingWindow('rl:test')).resolves.toBeUndefined()
    })

    it('setLockoutFlag retorna false', async () => {
      const r = await setLockoutFlag({ key: 'rl:lockout:test', reason: 'test' })
      expect(r).toBe(false)
    })

    it('getLockoutFlag retorna undefined (Redis indisponível)', async () => {
      const r = await getLockoutFlag('rl:lockout:test')
      expect(r).toBeUndefined()
    })

    it('evaluateLockoutRedis retorna null', async () => {
      const r = await evaluateLockoutRedis({ email: 'foo@bar.com', ip: '1.2.3.4' })
      expect(r).toBeNull()
    })

    it('checkLockoutRedis retorna null', async () => {
      const r = await checkLockoutRedis({ email: 'foo@bar.com', ip: '1.2.3.4' })
      expect(r).toBeNull()
    })
  })

  describe('operations com Redis mockado (status=ready)', () => {
    // Mock ioredis com fake client que simula comportamento de produção
    const fakeClient: {
      status: string
      pipeline: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
      del: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
      quit: ReturnType<typeof vi.fn>
    } = {
      status: 'ready',
      pipeline: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
    }

    beforeEach(async () => {
      resetRedisClient()
      vi.resetModules()
      process.env.REDIS_URL = 'redis://localhost:6379'

      // Inject fake client por re-mockar o módulo
      vi.doMock('ioredis', () => ({
        default: vi.fn().mockImplementation(() => fakeClient),
      }))

      // Re-importa pra pegar o mock
      const mod = await import('./redis-rate-limit')
      ;(mod as unknown as { __reset?: () => void }).__reset?.()

      fakeClient.pipeline.mockReset()
      fakeClient.get.mockReset()
      fakeClient.set.mockReset()
      fakeClient.del.mockReset()
    })

    it('recordFailureSlidingWindow chama pipeline ZADD+ZREMRANGEBYSCORE+ZCOUNT+PEXPIRE', async () => {
      const mod = await import('./redis-rate-limit')
      const pipeMock = {
        zadd: vi.fn().mockReturnThis(),
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1], // zadd
          [null, 0], // zremrangebyscore
          [null, 3], // zcount → 3 falhas
          [null, 1], // pexpire
        ]),
      }
      fakeClient.pipeline.mockReturnValue(pipeMock)

      const count = await mod.recordFailureSlidingWindow({ key: 'rl:auth:ip:1.2.3.4' })
      expect(count).toBe(3)
      expect(pipeMock.zadd).toHaveBeenCalledWith(
        'rl:auth:ip:1.2.3.4',
        expect.any(Number),
        expect.stringMatching(/^\d+-/),
      )
      expect(pipeMock.zremrangebyscore).toHaveBeenCalledWith(
        'rl:auth:ip:1.2.3.4',
        0,
        expect.any(Number),
      )
      expect(pipeMock.zcount).toHaveBeenCalledWith('rl:auth:ip:1.2.3.4', expect.any(Number), '+inf')
      expect(pipeMock.pexpire).toHaveBeenCalled()
    })

    it('countFailuresSlidingWindow chama ZREMRANGEBYSCORE + ZCOUNT', async () => {
      const mod = await import('./redis-rate-limit')
      const pipeMock = {
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 2],
        ]),
      }
      fakeClient.pipeline.mockReturnValue(pipeMock)

      const count = await mod.countFailuresSlidingWindow({ key: 'rl:auth:ip:1.2.3.4' })
      expect(count).toBe(2)
    })

    it('setLockoutFlag chama SET com PX NX', async () => {
      const mod = await import('./redis-rate-limit')
      fakeClient.set.mockResolvedValue('OK')

      const r = await mod.setLockoutFlag({
        key: 'rl:lockout:ip:1.2.3.4',
        reason: 'too_many',
        durationMs: 30 * 60 * 1000,
      })
      expect(r).toBe(true)
      expect(fakeClient.set).toHaveBeenCalledWith(
        'rl:lockout:ip:1.2.3.4',
        'too_many',
        'PX',
        30 * 60 * 1000,
        'NX',
      )
    })

    it('setLockoutFlag retorna false quando já existe (SET NX → null)', async () => {
      const mod = await import('./redis-rate-limit')
      fakeClient.set.mockResolvedValue(null)
      const r = await mod.setLockoutFlag({
        key: 'rl:lockout:ip:1.2.3.4',
        reason: 'too_many',
      })
      expect(r).toBe(false)
    })

    it('getLockoutFlag retorna string reason quando existe', async () => {
      const mod = await import('./redis-rate-limit')
      fakeClient.get.mockResolvedValue('too_many_failures_ip')
      const r = await mod.getLockoutFlag('rl:lockout:ip:1.2.3.4')
      expect(r).toBe('too_many_failures_ip')
    })

    it('getLockoutFlag retorna null quando não existe (distingue de undefined Redis-down)', async () => {
      const mod = await import('./redis-rate-limit')
      fakeClient.get.mockResolvedValue(null)
      const r = await mod.getLockoutFlag('rl:lockout:ip:1.2.3.4')
      expect(r).toBeNull()
    })

    it('clearFailuresSlidingWindow chama DEL', async () => {
      const mod = await import('./redis-rate-limit')
      fakeClient.del.mockResolvedValue(1)
      await mod.clearFailuresSlidingWindow('rl:auth:ip:1.2.3.4')
      expect(fakeClient.del).toHaveBeenCalledWith('rl:auth:ip:1.2.3.4')
    })
  })

  describe('failure modes (pipeline.exec retorna null/erro)', () => {
    beforeEach(async () => {
      resetRedisClient()
      vi.resetModules()
      process.env.REDIS_URL = 'redis://localhost:6379'
    })

    it('recordFailureSlidingWindow retorna null se pipeline.exec retorna null', async () => {
      const fakeClient = {
        status: 'ready',
        pipeline: vi.fn().mockReturnValue({
          zadd: vi.fn().mockReturnThis(),
          zremrangebyscore: vi.fn().mockReturnThis(),
          zcount: vi.fn().mockReturnThis(),
          pexpire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue(null),
        }),
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
      }
      vi.doMock('ioredis', () => ({
        default: vi.fn().mockImplementation(() => fakeClient),
      }))

      const mod = await import('./redis-rate-limit')
      const r = await mod.recordFailureSlidingWindow({ key: 'rl:test' })
      expect(r).toBeNull()
    })

    it('recordFailureSlidingWindow retorna null se pipeline throw', async () => {
      const fakeClient = {
        status: 'ready',
        pipeline: vi.fn().mockReturnValue({
          zadd: vi.fn().mockReturnThis(),
          zremrangebyscore: vi.fn().mockReturnThis(),
          zcount: vi.fn().mockReturnThis(),
          pexpire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockRejectedValue(new Error('connection lost')),
        }),
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue('OK'),
      }
      vi.doMock('ioredis', () => ({
        default: vi.fn().mockImplementation(() => fakeClient),
      }))

      const mod = await import('./redis-rate-limit')
      const r = await mod.recordFailureSlidingWindow({ key: 'rl:test' })
      expect(r).toBeNull()
    })
  })
})
