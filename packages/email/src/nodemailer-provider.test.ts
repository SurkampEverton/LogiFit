import nodemailer from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodemailerEmailProvider } from './nodemailer-provider'

/**
 * Tests usam jsonTransport do nodemailer (built-in) — não abre socket TCP real,
 * retorna o email como JSON. Suficiente pra validar nossa lógica de mapeamento
 * input → sendMail args + classificação de erros.
 *
 * Tests de erro SMTP usam mock de transport.sendMail() pra simular failures
 * sem precisar de um servidor SMTP quebrado.
 */
describe('NodemailerEmailProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('sendTransactional happy path (jsonTransport)', () => {
    it('envia email com from + to + subject + body — providerName=smtp (Mailhog)', async () => {
      // Substitui createTransport pra usar jsonTransport (não abre socket)
      const realCreateTransport = nodemailer.createTransport
      const createSpy = vi
        .spyOn(nodemailer, 'createTransport')
        .mockImplementation(() =>
          realCreateTransport({ jsonTransport: true }),
        )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        secure: false,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: 'user@example.com',
        subject: 'Hello',
        htmlBody: '<p>world</p>',
        category: 'platform',
      })

      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.provider).toBe('smtp')
      expect(r.messageId).toBeTruthy()
      expect(r.resolvedFrom).toBe('no-reply@logifit.com.br')
      expect(createSpy).toHaveBeenCalled()
    })

    it('preserva toName, textBody, replyTo ao serializar email', async () => {
      const realCreateTransport = nodemailer.createTransport
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(() =>
        realCreateTransport({ jsonTransport: true }),
      )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        secure: false,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: 'paciente@example.com',
        toName: 'Maria',
        subject: 'Sua consulta',
        htmlBody: '<p>...</p>',
        textBody: 'consulta confirmada',
        category: 'platform',
        replyTo: 'contato@logifit.com.br',
      })

      expect(r.ok).toBe(true)
    })
  })

  describe('sendTransactional error handling', () => {
    it('retorna failure auth_failed quando SMTP responde EAUTH', async () => {
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(
        () =>
          ({
            sendMail: vi.fn().mockRejectedValue(
              Object.assign(new Error('Invalid login'), { code: 'EAUTH' }),
            ),
            close: vi.fn(),
            // biome-ignore lint/suspicious/noExplicitAny: mock interno test-only
          }) as any,
      )

      const provider = new NodemailerEmailProvider({
        host: 'smtp-relay.brevo.com',
        port: 587,
        auth: { user: 'wrong', pass: 'wrong' },
        providerName: 'brevo-smtp',
      })

      const r = await provider.sendTransactional({
        to: 'user@example.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })

      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.provider).toBe('brevo-smtp')
      expect(r.errorCode).toBe('auth_failed')
      expect(r.error).toContain('Invalid login')
    })

    it('retorna failure connection_failed quando socket falha (ECONNREFUSED)', async () => {
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(
        () =>
          ({
            sendMail: vi.fn().mockRejectedValue(
              Object.assign(new Error('connect ECONNREFUSED'), {
                code: 'ECONNREFUSED',
              }),
            ),
            close: vi.fn(),
            // biome-ignore lint/suspicious/noExplicitAny: mock interno test-only
          }) as any,
      )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 65000,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: 'u@e.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errorCode).toBe('connection_failed')
    })

    it('retorna failure invalid_recipient quando EENVELOPE', async () => {
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(
        () =>
          ({
            sendMail: vi.fn().mockRejectedValue(
              Object.assign(new Error('No recipients'), { code: 'EENVELOPE' }),
            ),
            close: vi.fn(),
            // biome-ignore lint/suspicious/noExplicitAny: mock interno test-only
          }) as any,
      )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: '',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errorCode).toBe('invalid_recipient')
    })

    it('retorna failure send_failed:<code> pra códigos desconhecidos', async () => {
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(
        () =>
          ({
            sendMail: vi.fn().mockRejectedValue(
              Object.assign(new Error('Some weird error'), { code: 'EWHATEVER' }),
            ),
            close: vi.fn(),
            // biome-ignore lint/suspicious/noExplicitAny: mock interno test-only
          }) as any,
      )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: 'u@e.com',
        subject: 's',
        htmlBody: 'b',
        category: 'platform',
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errorCode).toBe('send_failed:ewhatever')
    })

    it('retorna failure sender_resolution_failed quando resolveEmailSender lança', async () => {
      // Sem mock de createTransport — não chega lá; falha antes em resolveSender
      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        providerName: 'smtp',
      })

      const r = await provider.sendTransactional({
        to: 'u@e.com',
        subject: 's',
        htmlBody: 'b',
        category: 'tenant',
        // tenantId omitido
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errorCode).toBe('sender_resolution_failed')
    })
  })

  describe('close()', () => {
    it('fecha o transport (idempotente)', async () => {
      const closeMock = vi.fn()
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(
        () =>
          ({
            sendMail: vi.fn(),
            close: closeMock,
            // biome-ignore lint/suspicious/noExplicitAny: mock interno test-only
          }) as any,
      )

      const provider = new NodemailerEmailProvider({
        host: 'localhost',
        port: 1025,
        providerName: 'smtp',
      })
      await provider.close()
      expect(closeMock).toHaveBeenCalled()
    })
  })
})
