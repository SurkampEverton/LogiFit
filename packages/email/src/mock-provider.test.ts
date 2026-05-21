import { describe, expect, it } from 'vitest'
import { MockEmailProvider } from './mock-provider'

describe('MockEmailProvider', () => {
  it('grava email enviado em recordedEmails', async () => {
    const provider = new MockEmailProvider()
    const r = await provider.sendTransactional({
      to: 'user@example.com',
      subject: 'Confirme seu cadastro',
      htmlBody: '<p>Click aqui</p>',
      category: 'platform',
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return // type narrow
    expect(r.provider).toBe('mock')
    expect(r.messageId).toMatch(/^<mock-\d+-1@logifit\.local>$/)
    expect(r.resolvedFrom).toBe('no-reply@logifit.com.br')

    expect(provider.recordedEmails).toHaveLength(1)
    expect(provider.recordedEmails[0]?.to).toBe('user@example.com')
    expect(provider.recordedEmails[0]?.subject).toBe('Confirme seu cadastro')
    expect(provider.recordedEmails[0]?.resolvedFrom).toBe('no-reply@logifit.com.br')
  })

  it('counter incrementa entre envios — messageIds únicos', async () => {
    const provider = new MockEmailProvider()
    await provider.sendTransactional({
      to: 'a@example.com',
      subject: 's',
      htmlBody: 'b',
      category: 'platform',
    })
    await provider.sendTransactional({
      to: 'b@example.com',
      subject: 's',
      htmlBody: 'b',
      category: 'platform',
    })
    expect(provider.recordedEmails).toHaveLength(2)
    expect(provider.recordedEmails[0]?.messageId).not.toBe(
      provider.recordedEmails[1]?.messageId,
    )
  })

  it('clear() reseta histórico e counter', async () => {
    const provider = new MockEmailProvider()
    await provider.sendTransactional({
      to: 'a@example.com',
      subject: 's',
      htmlBody: 'b',
      category: 'platform',
    })
    provider.clear()
    expect(provider.recordedEmails).toHaveLength(0)

    const r = await provider.sendTransactional({
      to: 'c@example.com',
      subject: 's',
      htmlBody: 'b',
      category: 'platform',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // counter voltou a 1 após clear
    expect(r.messageId).toMatch(/-1@/)
  })

  it('retorna failure quando resolveEmailSender lança (category=tenant sem tenantId)', async () => {
    const provider = new MockEmailProvider()
    const r = await provider.sendTransactional({
      to: 'user@example.com',
      subject: 's',
      htmlBody: 'b',
      category: 'tenant',
      // tenantId omitido — viola ADR 0097
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('sender_resolution_failed')
    expect(r.error).toMatch(/tenantId/)
    expect(provider.recordedEmails).toHaveLength(0) // não grava falhas
  })

  it('preserva todos campos do input em recordedEmails', async () => {
    const provider = new MockEmailProvider()
    await provider.sendTransactional({
      to: 'paciente@example.com',
      toName: 'Maria',
      subject: 'Sua consulta',
      htmlBody: '<p>...</p>',
      textBody: 'consulta confirmada',
      category: 'tenant',
      tenantId: 'tenant-abc',
      replyTo: 'contato@academia-vital.com.br',
    })
    const rec = provider.recordedEmails[0]
    expect(rec?.toName).toBe('Maria')
    expect(rec?.textBody).toBe('consulta confirmada')
    expect(rec?.category).toBe('tenant')
    expect(rec?.tenantId).toBe('tenant-abc')
    expect(rec?.replyTo).toBe('contato@academia-vital.com.br')
    expect(rec?.resolvedReplyTo).toBe('contato@academia-vital.com.br')
  })
})
