import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockEmailProvider } from './mock-provider'
import { NodemailerEmailProvider } from './nodemailer-provider'
import { resetEmailProvider, resolveEmailProvider } from './resolve-provider'

describe('resolveEmailProvider', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    resetEmailProvider()
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.BREVO_SMTP_HOST
    delete process.env.BREVO_SMTP_PORT
    delete process.env.BREVO_SMTP_USER
    delete process.env.BREVO_SMTP_PASSWORD
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetEmailProvider()
  })

  it('retorna MockEmailProvider quando NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    const p = resolveEmailProvider()
    expect(p).toBeInstanceOf(MockEmailProvider)
    expect(p.providerName).toBe('mock')
  })

  it('retorna NodemailerEmailProvider apontando pra Mailhog quando SMTP_HOST+PORT setados (dev)', () => {
    process.env.NODE_ENV = 'development'
    process.env.SMTP_HOST = 'localhost'
    process.env.SMTP_PORT = '1025'
    const p = resolveEmailProvider()
    expect(p).toBeInstanceOf(NodemailerEmailProvider)
    expect(p.providerName).toBe('smtp')
  })

  it('retorna NodemailerEmailProvider apontando pra Brevo quando BREVO_SMTP_* completo (prod path)', () => {
    process.env.NODE_ENV = 'production'
    process.env.BREVO_SMTP_HOST = 'smtp-relay.brevo.com'
    process.env.BREVO_SMTP_PORT = '587'
    process.env.BREVO_SMTP_USER = 'ac0675001@smtp-brevo.com'
    process.env.BREVO_SMTP_PASSWORD = 'xsmtpsib-abc'
    const p = resolveEmailProvider()
    expect(p).toBeInstanceOf(NodemailerEmailProvider)
    expect(p.providerName).toBe('brevo-smtp')
  })

  it('dev sem Mailhog + sem Brevo → MockEmailProvider (não throw)', () => {
    process.env.NODE_ENV = 'development'
    const p = resolveEmailProvider()
    expect(p).toBeInstanceOf(MockEmailProvider)
  })

  it('production sem nenhum SMTP configurado → throw', () => {
    process.env.NODE_ENV = 'production'
    expect(() => resolveEmailProvider()).toThrow(/produção/)
  })

  it('production com BREVO_SMTP_* incompleto → throw', () => {
    process.env.NODE_ENV = 'production'
    process.env.BREVO_SMTP_HOST = 'smtp-relay.brevo.com'
    process.env.BREVO_SMTP_PORT = '587'
    // BREVO_SMTP_USER + PASSWORD ausentes
    expect(() => resolveEmailProvider()).toThrow(/produção/)
  })

  it('singleton — chamadas repetidas retornam mesma instância', () => {
    process.env.NODE_ENV = 'test'
    const p1 = resolveEmailProvider()
    const p2 = resolveEmailProvider()
    expect(p1).toBe(p2)
  })

  it('resetEmailProvider() força recriação no próximo call', () => {
    process.env.NODE_ENV = 'test'
    const p1 = resolveEmailProvider()
    resetEmailProvider()
    const p2 = resolveEmailProvider()
    expect(p1).not.toBe(p2)
  })

  it('Brevo prefere sobre Mailhog quando NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production'
    process.env.SMTP_HOST = 'localhost'
    process.env.SMTP_PORT = '1025'
    process.env.BREVO_SMTP_HOST = 'smtp-relay.brevo.com'
    process.env.BREVO_SMTP_PORT = '587'
    process.env.BREVO_SMTP_USER = 'u'
    process.env.BREVO_SMTP_PASSWORD = 'p'
    const p = resolveEmailProvider()
    expect(p.providerName).toBe('brevo-smtp')
  })
})
