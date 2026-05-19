/**
 * SMS OTP provider — Twilio (Sprint 02b path B cadastro proativo).
 *
 * Provider abstrato com mock em dev (loga código no console) e envio real em
 * prod via Twilio API. Mock permite desenvolvimento local sem credentials.
 *
 * Uso típico (Server Action `requestSmsCode` Sprint 02b):
 *   const code = generateOtpCode() // 6 dígitos
 *   await sendSmsOtp({ phone: '+5511999999999', code })
 *   // grava hash(code) + expires_at em passport_signup_otps
 *
 * **MVP**: mock provider quando `TWILIO_AUTH_TOKEN` não setado; produção
 * requer credentials configuradas.
 *
 * Sprint 02b2: configurar Twilio sandbox + LGPD DPA + envelope encryption das
 * credentials via LOGIFIT_DATA_KEY (ADR 0073).
 */

import { createHash, randomInt } from 'node:crypto'

export interface SmsOtpSendInput {
  /** Telefone E.164 (`+5511999999999`) */
  phone: string
  /** Código de 6 dígitos (geralmente gerado por `generateOtpCode`) */
  code: string
  /** Idioma da mensagem (default `pt-BR`) */
  locale?: 'pt-BR' | 'en-US' | 'es-419'
}

export interface SmsOtpSendResult {
  /** True se envio foi aceito pelo provider (não garante entrega — webhook callback confirma) */
  sent: boolean
  /** Provider que respondeu (twilio/mock) */
  provider: 'twilio' | 'mock'
  /** Twilio message SID (audit) */
  messageSid?: string
  /** Erro do provider (pra logging — não expor ao caller) */
  errorMessage?: string
}

/**
 * Gera código OTP de 6 dígitos numéricos (000000-999999).
 * Usa crypto.randomInt — secure random (não Math.random).
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Hash SHA-256 do código pra persistência (nunca grava plain).
 */
export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * Constant-time comparison de código com hash (anti-timing-attack).
 */
export function verifyOtpCode(plain: string, hash: string): boolean {
  const plainHash = hashOtpCode(plain)
  if (plainHash.length !== hash.length) return false
  // Buffer.compare é constant-time pra arrays de mesmo tamanho
  let acc = 0
  for (let i = 0; i < plainHash.length; i++) {
    acc |= plainHash.charCodeAt(i) ^ hash.charCodeAt(i)
  }
  return acc === 0
}

const SMS_TEMPLATES: Record<NonNullable<SmsOtpSendInput['locale']>, (code: string) => string> = {
  'pt-BR': (code) =>
    `Seu código LogiFit é ${code}. Válido por 5 minutos. Não compartilhe com ninguém.`,
  'en-US': (code) =>
    `Your LogiFit code is ${code}. Valid for 5 minutes. Do not share with anyone.`,
  'es-419': (code) =>
    `Tu código LogiFit es ${code}. Válido por 5 minutos. No lo compartas con nadie.`,
}

/**
 * Envia OTP via SMS.
 *
 * Estratégia:
 *   - Se `TWILIO_AUTH_TOKEN` + `TWILIO_ACCOUNT_SID` + `TWILIO_FROM_NUMBER` não
 *     setados → mock (loga código no console em dev)
 *   - Se setados → POST pra Twilio Messages API
 *   - Em prod com credentials faltando → throw (config inválida)
 *
 * @example
 *   const code = generateOtpCode()
 *   const r = await sendSmsOtp({ phone, code })
 *   if (!r.sent) throw new Error('SMS provider falhou')
 *   // grava hashOtpCode(code) em passport_signup_otps
 */
export async function sendSmsOtp(input: SmsOtpSendInput): Promise<SmsOtpSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_FROM_NUMBER

  const locale = input.locale ?? 'pt-BR'
  const message = SMS_TEMPLATES[locale](input.code)

  if (!accountSid || !authToken || !fromNumber) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[sms-otp] TWILIO_* credentials não setadas em produção — config inválida',
      )
    }
    // Mock: dev/test — loga código pra dev testar manualmente
    // biome-ignore lint/suspicious/noConsole: dev-only mock provider
    console.log(`[sms-otp:mock] → ${input.phone}: ${message}`)
    return { sent: true, provider: 'mock' }
  }

  // Real: Twilio Messages API
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const body = new URLSearchParams()
  body.set('To', input.phone)
  body.set('From', fromNumber)
  body.set('Body', message)

  try {
    // safe-fetch-exempt: Twilio Messages API é canônico do provider abstrato (este file); não passa por arbitrary URL do user
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${credentials}`,
      },
      body,
    })
    const data = (await res.json()) as { sid?: string; error_message?: string }
    if (!res.ok) {
      return {
        sent: false,
        provider: 'twilio',
        errorMessage: data.error_message ?? `HTTP ${res.status}`,
      }
    }
    return { sent: true, provider: 'twilio', messageSid: data.sid }
  } catch (err) {
    return {
      sent: false,
      provider: 'twilio',
      errorMessage: err instanceof Error ? err.message : 'unknown',
    }
  }
}
