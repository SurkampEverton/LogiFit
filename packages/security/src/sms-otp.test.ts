/**
 * sms-otp — unit tests (Sprint 02b backbone).
 *
 * Cobertura:
 *   - generateOtpCode: 6 dígitos numéricos zero-padded
 *   - hashOtpCode: SHA-256 hex determinístico
 *   - verifyOtpCode: constant-time, case-sensitive
 *   - sendSmsOtp: mock dev (loga) + real prod (Twilio API) + throw em prod sem creds
 *   - 3 templates SMS pt-BR/en-US/es-419
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateOtpCode,
  hashOtpCode,
  sendSmsOtp,
  verifyOtpCode,
} from './sms-otp'

describe('sms-otp', () => {
  describe('generateOtpCode', () => {
    it('retorna 6 chars numéricos', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateOtpCode()
        expect(code).toMatch(/^\d{6}$/)
      }
    })

    it('zero-padded quando valor baixo (000001-099999)', () => {
      // Run várias vezes — entropia 1M; eventualmente bate código < 100k
      // (probabilidade 10% por chamada). 100 runs → muito provável pelo
      // menos 1 com padding.
      let foundPadded = false
      for (let i = 0; i < 500 && !foundPadded; i++) {
        const code = generateOtpCode()
        if (code.startsWith('0')) foundPadded = true
      }
      expect(foundPadded).toBe(true)
    })

    it('códigos variam entre chamadas (secure random)', () => {
      const codes = new Set<string>()
      for (let i = 0; i < 20; i++) {
        codes.add(generateOtpCode())
      }
      // 20 chamadas em espaço de 1M — colisão extremamente improvável
      expect(codes.size).toBeGreaterThan(15)
    })
  })

  describe('hashOtpCode', () => {
    it('hash determinístico', () => {
      expect(hashOtpCode('123456')).toBe(hashOtpCode('123456'))
    })

    it('hash é SHA-256 hex (64 chars)', () => {
      const hash = hashOtpCode('123456')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('códigos diferentes geram hashes diferentes', () => {
      expect(hashOtpCode('123456')).not.toBe(hashOtpCode('123457'))
      expect(hashOtpCode('000000')).not.toBe(hashOtpCode('999999'))
    })

    it('hash não revela code (one-way)', () => {
      const hash = hashOtpCode('123456')
      expect(hash).not.toContain('123456')
    })
  })

  describe('verifyOtpCode', () => {
    it('round-trip básico true', () => {
      const code = '654321'
      expect(verifyOtpCode(code, hashOtpCode(code))).toBe(true)
    })

    it('código errado retorna false', () => {
      const hash = hashOtpCode('123456')
      expect(verifyOtpCode('123457', hash)).toBe(false)
      expect(verifyOtpCode('999999', hash)).toBe(false)
    })

    it('case-sensitive (sempre numérico, mas garantia)', () => {
      // OTP é numérico — case não se aplica. Esta test garante que
      // string compare é exato (defesa em profundidade pra evolução futura).
      const code = '654321'
      const hash = hashOtpCode(code)
      expect(verifyOtpCode(code, hash)).toBe(true)
      expect(verifyOtpCode(` ${code}`, hash)).toBe(false)
    })

    it('hash de tamanho errado retorna false (fail-closed)', () => {
      expect(verifyOtpCode('123456', 'short-hash')).toBe(false)
      expect(verifyOtpCode('123456', '')).toBe(false)
    })

    it('strings vazias retornam false', () => {
      // Hash de string vazia é válido SHA-256 mas plain vazio não bate com '123456'
      expect(verifyOtpCode('', hashOtpCode('123456'))).toBe(false)
    })
  })

  describe('sendSmsOtp', () => {
    const originalAccountSid = process.env.TWILIO_ACCOUNT_SID
    const originalAuthToken = process.env.TWILIO_AUTH_TOKEN
    const originalFromNumber = process.env.TWILIO_FROM_NUMBER
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      function restore(key: string, val: string | undefined) {
        if (val === undefined) delete process.env[key]
        else process.env[key] = val
      }
      restore('TWILIO_ACCOUNT_SID', originalAccountSid)
      restore('TWILIO_AUTH_TOKEN', originalAuthToken)
      restore('TWILIO_FROM_NUMBER', originalFromNumber)
      process.env.NODE_ENV = originalNodeEnv
      vi.restoreAllMocks()
    })

    describe('mock provider (sem TWILIO_* setado)', () => {
      beforeEach(() => {
        delete process.env.TWILIO_ACCOUNT_SID
        delete process.env.TWILIO_AUTH_TOKEN
        delete process.env.TWILIO_FROM_NUMBER
        process.env.NODE_ENV = 'development'
      })

      it('retorna sent=true provider=mock', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const r = await sendSmsOtp({ phone: '+5511999999999', code: '123456' })
        expect(r.sent).toBe(true)
        expect(r.provider).toBe('mock')
        expect(logSpy).toHaveBeenCalled()
        // Mensagem deve mencionar phone + code
        const logged = logSpy.mock.calls[0]![0]
        expect(logged).toContain('+5511999999999')
        expect(logged).toContain('123456')
      })

      it('template pt-BR (default) tem "código LogiFit" e "5 minutos"', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        await sendSmsOtp({ phone: '+55119', code: '111111' })
        expect(logSpy.mock.calls[0]![0]).toContain('código LogiFit')
        expect(logSpy.mock.calls[0]![0]).toContain('5 minutos')
        expect(logSpy.mock.calls[0]![0]).toContain('Não compartilhe')
      })

      it('template en-US tem "LogiFit code" e "5 minutes"', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        await sendSmsOtp({ phone: '+12345678901', code: '222222', locale: 'en-US' })
        expect(logSpy.mock.calls[0]![0]).toContain('LogiFit code')
        expect(logSpy.mock.calls[0]![0]).toContain('5 minutes')
        expect(logSpy.mock.calls[0]![0]).toContain('Do not share')
      })

      it('template es-419 tem "código LogiFit" e "5 minutos"', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        await sendSmsOtp({ phone: '+5491112345678', code: '333333', locale: 'es-419' })
        expect(logSpy.mock.calls[0]![0]).toContain('código LogiFit')
        expect(logSpy.mock.calls[0]![0]).toContain('No lo compartas')
      })
    })

    describe('produção sem creds (config invariant)', () => {
      beforeEach(() => {
        delete process.env.TWILIO_ACCOUNT_SID
        process.env.NODE_ENV = 'production'
      })

      it('lança quando faltam TWILIO_* em prod', async () => {
        await expect(
          sendSmsOtp({ phone: '+55119', code: '123456' }),
        ).rejects.toThrow(/TWILIO_/)
      })
    })

    describe('real provider (Twilio Messages API)', () => {
      beforeEach(() => {
        process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid'
        process.env.TWILIO_AUTH_TOKEN = 'test_token'
        process.env.TWILIO_FROM_NUMBER = '+15558888888'
        process.env.NODE_ENV = 'production'
      })

      it('POST pra Twilio com Basic auth + To/From/Body', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ sid: 'SM_test_message_sid' }),
        })
        vi.stubGlobal('fetch', fetchSpy)

        const r = await sendSmsOtp({ phone: '+5511999999999', code: '123456' })

        expect(fetchSpy).toHaveBeenCalledOnce()
        const [url, init] = fetchSpy.mock.calls[0]!
        expect(url).toContain('https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json')
        expect(init.method).toBe('POST')
        expect(init.headers.authorization).toMatch(/^Basic /)
        // Basic auth = base64(account_sid:token)
        const decoded = Buffer.from(init.headers.authorization.slice(6), 'base64').toString()
        expect(decoded).toBe('AC_test_sid:test_token')

        const body = (init.body as URLSearchParams).toString()
        expect(body).toContain('To=%2B5511999999999')
        expect(body).toContain('From=%2B15558888888')
        expect(body).toContain('Body=')

        expect(r.sent).toBe(true)
        expect(r.provider).toBe('twilio')
        expect(r.messageSid).toBe('SM_test_message_sid')
      })

      it('HTTP error não-2xx → sent=false + errorMessage', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error_message: 'Invalid phone number' }),
          }),
        )

        const r = await sendSmsOtp({ phone: 'invalid', code: '123456' })
        expect(r.sent).toBe(false)
        expect(r.provider).toBe('twilio')
        expect(r.errorMessage).toBe('Invalid phone number')
      })

      it('HTTP error sem error_message → "HTTP <status>"', async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({}),
          }),
        )

        const r = await sendSmsOtp({ phone: '+55119', code: '123456' })
        expect(r.errorMessage).toBe('HTTP 500')
      })

      it('fetch lança → sent=false + errorMessage', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')))

        const r = await sendSmsOtp({ phone: '+55119', code: '123456' })
        expect(r.sent).toBe(false)
        expect(r.errorMessage).toBe('Network timeout')
      })

      it('fetch lança não-Error → "unknown"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'))
        const r = await sendSmsOtp({ phone: '+55119', code: '123456' })
        expect(r.errorMessage).toBe('unknown')
      })
    })
  })
})
