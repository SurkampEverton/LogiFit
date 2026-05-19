/**
 * captcha — unit tests (Sprint 02b backbone).
 *
 * Cobertura:
 *   - Mock provider (dev/test sem TURNSTILE_SECRET_KEY)
 *   - Real provider (prod com secret) com fetch mockado
 *   - Throw em prod sem secret (config invariant)
 *   - Edge cases (token vazio, fetch falha, JSON malformed)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyCaptcha } from './captcha'

describe('captcha verifyCaptcha', () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalSecret
    }
    process.env.NODE_ENV = originalNodeEnv
    vi.restoreAllMocks()
  })

  describe('mock provider (sem TURNSTILE_SECRET_KEY)', () => {
    beforeEach(() => {
      delete process.env.TURNSTILE_SECRET_KEY
      process.env.NODE_ENV = 'development'
    })

    it('valida token não-vazio em dev', async () => {
      const r = await verifyCaptcha({ token: 'qualquer-token' })
      expect(r.valid).toBe(true)
      expect(r.provider).toBe('mock')
    })

    it('rejeita token vazio (length 0)', async () => {
      const r = await verifyCaptcha({ token: '' })
      expect(r.valid).toBe(false)
      expect(r.provider).toBe('mock')
    })

    it('aceita token de qualquer formato (não valida estrutura)', async () => {
      const r = await verifyCaptcha({ token: 'a' })
      expect(r.valid).toBe(true)
    })
  })

  describe('produção sem secret (config invariant)', () => {
    beforeEach(() => {
      delete process.env.TURNSTILE_SECRET_KEY
      process.env.NODE_ENV = 'production'
    })

    it('lança erro em prod sem TURNSTILE_SECRET_KEY', async () => {
      await expect(verifyCaptcha({ token: 'x' })).rejects.toThrow(
        /TURNSTILE_SECRET_KEY/,
      )
    })
  })

  describe('real provider (TURNSTILE_SECRET_KEY setado)', () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = 'test-secret-key'
      process.env.NODE_ENV = 'production'
    })

    it('POST pro siteverify com secret + response + remoteip', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, action: 'cadastro' }),
      })
      vi.stubGlobal('fetch', fetchSpy)

      const r = await verifyCaptcha({ token: 'real-token', remoteIp: '1.2.3.4' })

      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
      expect(init.method).toBe('POST')
      expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded')

      // Verifica body via URLSearchParams toString
      const body = (init.body as URLSearchParams).toString()
      expect(body).toContain('secret=test-secret-key')
      expect(body).toContain('response=real-token')
      expect(body).toContain('remoteip=1.2.3.4')

      expect(r.valid).toBe(true)
      expect(r.provider).toBe('turnstile')
      expect(r.action).toBe('cadastro')
    })

    it('omitte remoteip quando não passado', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        json: async () => ({ success: true }),
      })
      vi.stubGlobal('fetch', fetchSpy)

      await verifyCaptcha({ token: 'x' })

      const body = (fetchSpy.mock.calls[0]![1] as { body: URLSearchParams }).body.toString()
      expect(body).not.toContain('remoteip')
    })

    it('Cloudflare retorna success=false → valid=false + errorCodes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({
            success: false,
            'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
          }),
        }),
      )

      const r = await verifyCaptcha({ token: 'expired-token' })
      expect(r.valid).toBe(false)
      expect(r.provider).toBe('turnstile')
      expect(r.errorCodes).toEqual(['invalid-input-response', 'timeout-or-duplicate'])
    })

    it('fetch lança (network error) → valid=false + errorCodes', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const r = await verifyCaptcha({ token: 'x' })
      expect(r.valid).toBe(false)
      expect(r.provider).toBe('turnstile')
      expect(r.errorCodes?.[0]).toContain('fetch_error:ECONNREFUSED')
    })

    it('fetch lança não-Error → fetch_error:unknown', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'))

      const r = await verifyCaptcha({ token: 'x' })
      expect(r.errorCodes?.[0]).toBe('fetch_error:unknown')
    })
  })
})
