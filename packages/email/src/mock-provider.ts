/**
 * MockEmailProvider — usado em testes (vitest) e ambientes sem SMTP disponível.
 *
 * Não envia nada — só loga via `recordedEmails` (acessível pelo test pra assertions)
 * + retorna `messageId` determinístico baseado em timestamp + counter.
 *
 * Uso em test:
 *   const provider = new MockEmailProvider()
 *   const r = await provider.sendTransactional({...})
 *   expect(provider.recordedEmails).toHaveLength(1)
 *   expect(provider.recordedEmails[0].to).toBe('user@example.com')
 */

import { resolveEmailSender } from './resolve-sender'
import type {
  EmailProvider,
  SendTransactionalInput,
  SendTransactionalResult,
} from './types'

export interface RecordedEmail extends SendTransactionalInput {
  resolvedFrom: string
  resolvedFromName: string
  resolvedReplyTo?: string
  messageId: string
  timestamp: Date
}

export class MockEmailProvider implements EmailProvider {
  readonly providerName = 'mock' as const

  /** Histórico de emails "enviados" — pra assertions em tests. */
  readonly recordedEmails: RecordedEmail[] = []

  private counter = 0

  async sendTransactional(input: SendTransactionalInput): Promise<SendTransactionalResult> {
    let sender: ReturnType<typeof resolveEmailSender>
    try {
      sender = resolveEmailSender(input)
    } catch (err) {
      return {
        ok: false,
        provider: 'mock',
        error: err instanceof Error ? err.message : 'unknown_sender_error',
        errorCode: 'sender_resolution_failed',
      }
    }

    this.counter += 1
    const messageId = `<mock-${Date.now()}-${this.counter}@logifit.local>`

    this.recordedEmails.push({
      ...input,
      resolvedFrom: sender.fromEmail,
      resolvedFromName: sender.fromName,
      resolvedReplyTo: sender.replyTo,
      messageId,
      timestamp: new Date(),
    })

    return {
      ok: true,
      provider: 'mock',
      messageId,
      resolvedFrom: sender.fromEmail,
    }
  }

  /** Limpa histórico — útil entre tests pra isolar estado. */
  clear(): void {
    this.recordedEmails.length = 0
    this.counter = 0
  }
}
