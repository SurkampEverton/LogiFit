import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveEmailSender } from './resolve-sender'

describe('resolveEmailSender', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.EMAIL_FROM
    delete process.env.EMAIL_FROM_NAME
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('category=platform', () => {
    it('usa defaults LogiFit quando env vars não setadas', () => {
      const r = resolveEmailSender({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })
      expect(r.fromEmail).toBe('no-reply@logifit.com.br')
      expect(r.fromName).toBe('LogiFit')
      expect(r.replyTo).toBeUndefined()
    })

    it('usa EMAIL_FROM e EMAIL_FROM_NAME do env quando setados', () => {
      process.env.EMAIL_FROM = 'custom@logifit.com.br'
      process.env.EMAIL_FROM_NAME = 'LogiFit Custom'
      const r = resolveEmailSender({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })
      expect(r.fromEmail).toBe('custom@logifit.com.br')
      expect(r.fromName).toBe('LogiFit Custom')
    })

    it('preserva replyTo do caller', () => {
      const r = resolveEmailSender({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
        replyTo: 'suporte@logifit.com.br',
      })
      expect(r.replyTo).toBe('suporte@logifit.com.br')
    })

    it('ignora tenantId quando category=platform (não precisa)', () => {
      const r = resolveEmailSender({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
        tenantId: 'should-be-ignored',
      })
      expect(r.fromEmail).toBe('no-reply@logifit.com.br')
    })
  })

  describe('category=tenant', () => {
    it('throw quando tenantId ausente (ADR 0097)', () => {
      expect(() =>
        resolveEmailSender({
          to: 'user@example.com',
          subject: 's',
          htmlBody: 'b',
          category: 'tenant',
        }),
      ).toThrow(/tenantId/)
    })

    it('fallback LogiFit quando tenantId fornecido (MVP sem schema tenant_email_settings)', () => {
      const r = resolveEmailSender({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'tenant',
        tenantId: 'tenant-abc',
      })
      expect(r.fromEmail).toBe('no-reply@logifit.com.br')
      expect(r.fromName).toBe('LogiFit')
    })

    it('preserva replyTo do tenant pra que paciente responda à empresa', () => {
      const r = resolveEmailSender({
        to: 'paciente@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'tenant',
        tenantId: 'tenant-abc',
        replyTo: 'contato@academia-vital.com.br',
      })
      expect(r.replyTo).toBe('contato@academia-vital.com.br')
    })
  })
})
