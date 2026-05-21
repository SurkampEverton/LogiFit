/**
 * Helpers Mailhog — interage com inbox local de dev (porta 8025).
 *
 * Mailhog roda em `pnpm dev:up`. Em CI, mesmo container via docker-compose.
 * Tests E2E usam pra validar emails enviados pelo `@repo/email` (ADR 0096).
 *
 * Refs: Mailhog API v2 — https://github.com/mailhog/MailHog/blob/master/docs/APIv2/swagger-2.0.yaml
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Mailhog API types are loose */

const MAILHOG_BASE = process.env.MAILHOG_URL ?? 'http://localhost:8025'

export interface MailhogMessage {
  ID: string
  Content: {
    Headers: Record<string, string[]>
    Body: string
  }
  // Outros campos do Mailhog API v2 não precisamos por enquanto
}

export interface MailhogInbox {
  total: number
  items: MailhogMessage[]
}

export async function listInbox(limit = 50): Promise<MailhogInbox> {
  const res = await fetch(`${MAILHOG_BASE}/api/v2/messages?limit=${limit}`)
  if (!res.ok) throw new Error(`Mailhog API failed: ${res.status}`)
  return (await res.json()) as MailhogInbox
}

export async function deleteAllMessages(): Promise<void> {
  const res = await fetch(`${MAILHOG_BASE}/api/v1/messages`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Mailhog DELETE failed: ${res.status}`)
}

/**
 * Aguarda email chegar pra um destinatário específico. Polling com timeout.
 *
 * @param to email destinatário (case-insensitive)
 * @param timeoutMs default 5s
 * @param subjectIncludes opcional — filtra por substring no subject (UTF-8 decoded)
 */
export async function waitForMessage(opts: {
  to: string
  timeoutMs?: number
  subjectIncludes?: string
}): Promise<MailhogMessage> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5000)
  const toLower = opts.to.toLowerCase()

  while (Date.now() < deadline) {
    const inbox = await listInbox(50)
    for (const msg of inbox.items) {
      // To pode estar em headers To[0] ou em Raw.To[]
      const toHeader = msg.Content?.Headers?.To?.[0] ?? ''
      if (!toHeader.toLowerCase().includes(toLower)) continue
      if (opts.subjectIncludes) {
        const subject = decodeMimeHeader(msg.Content?.Headers?.Subject?.[0] ?? '')
        if (!subject.includes(opts.subjectIncludes)) continue
      }
      return msg
    }
    await sleep(200)
  }
  throw new Error(
    `Mailhog: timeout aguardando email pra ${opts.to}${opts.subjectIncludes ? ` (subject ~"${opts.subjectIncludes}")` : ''}`,
  )
}

/**
 * Extrai URL do email decodificando quoted-printable encoding.
 * Procura por padrão regex (default: primeira URL https?://).
 */
export function extractUrlFromBody(body: string, pattern?: RegExp): string | null {
  const decoded = decodeQuotedPrintable(body)
  const re = pattern ?? /https?:\/\/[^\s<>"]+/
  const match = decoded.match(re)
  return match ? match[0] : null
}

/**
 * Decodifica quoted-printable encoding (RFC 2045). Necessário pra extrair URLs
 * de emails enviados via nodemailer (que codifica linhas longas).
 */
export function decodeQuotedPrintable(input: string): string {
  return input
    // Soft line breaks: =\n ou =\r\n (juntam linhas quebradas)
    .replace(/=\r?\n/g, '')
    // Hex escapes: =XX
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}

/**
 * Decodifica MIME encoded-word do header Subject (RFC 2047): `=?UTF-8?Q?...?=`
 * ou `=?UTF-8?B?...?=`. Simplificação MVP — não cobre todos charsets.
 */
function decodeMimeHeader(header: string): string {
  return header.replace(/=\?UTF-8\?([QB])\?([^?]+)\?=/gi, (_, enc, data) => {
    if (enc.toUpperCase() === 'Q') {
      // Quoted-printable encoding pra header (similar mas underscore vira espaço)
      return data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__: string, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
    }
    // Base64
    return Buffer.from(data, 'base64').toString('utf-8')
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
