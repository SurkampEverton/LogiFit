import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LOCALE, isLocale } from '@repo/i18n/config'

const COOKIE_LOCALE = 'NEXT_LOCALE'
const COOKIE_LOCALE_MAX_AGE = 60 * 60 * 24 * 365

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * CSP MVP conservador (regra 35 + ADR 0073).
 *
 * Sprints donos expandem `connect-src` quando integrarem providers:
 *   - Sprint 04 (Asaas): + https://api.asaas.com
 *   - Sprint 06 (IA):    + https://*.googleapis.com / api.anthropic.com / api.openai.com
 *   - Faixa 3 (GlitchTip + Loki self-host): + errors.logifit.com.br monitor.logifit.com.br
 *   - Sprint 13 (WhatsApp BSP): + Twilio/Gupshup endpoints
 *   - Sprint 36 (Focus NFe): + api.focusnfe.com.br
 *
 * Sem 'unsafe-inline' em script-src; nonce + 'strict-dynamic' propaga pelos
 * scripts internos do Next.js. style-src tolera 'unsafe-inline' por exigência
 * do Tailwind v4 (custom properties em runtime).
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
  response.headers.set('x-request-id', requestId)
  response.headers.set('content-security-policy', buildCsp(nonce))
  response.headers.set('x-nonce', nonce)

  if (!request.cookies.has(COOKIE_LOCALE)) {
    const acceptLanguage = request.headers.get('accept-language') ?? ''
    let detected = DEFAULT_LOCALE
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim()
      if (tag && isLocale(tag)) {
        detected = tag
        break
      }
    }
    response.cookies.set(COOKIE_LOCALE, detected, {
      maxAge: COOKIE_LOCALE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
    })
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
