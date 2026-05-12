import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LOCALE, isLocale } from '@repo/i18n/config'

const COOKIE_LOCALE = 'NEXT_LOCALE'
const COOKIE_LOCALE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Rotas que NÃO exigem sessão autenticada (ADR 0092 + regra 43).
 *
 * Tudo o que cai em `/app/*` exige sessão. Demais rotas (home, /seguranca,
 * /login, /signup, /api/auth/*, /.well-known/*) são públicas.
 *
 * O guard aqui é **leve**: lê apenas o cookie `logifit_session_token` (cookie
 * BetterAuth com nosso prefix configurado em `@repo/auth/server`). Validação
 * real da sessão (DB lookup) acontece em layout/page Server Component via
 * `auth.api.getSession({ headers })`.
 *
 * Por que não validar full no middleware:
 *   - Middleware roda em Edge runtime — sem pg
 *   - Validar full a cada request inflaria latência (DB hit em cada navegação)
 *   - Camada de defesa em profundidade: o pior caso (cookie presente mas
 *     sessão invalidada no DB) entra em /app/* e Server Component redireciona.
 */
const PROTECTED_PATH_PREFIXES = ['/app', '/meu']
const SESSION_COOKIE_NAME = 'logifit.session_token'

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
  const { pathname } = request.nextUrl

  // ─── Guard de sessão pra rotas protegidas ─────────────────────────────
  // Cookie ausente → redirect /login com `returnTo` query
  const isProtected = PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (isProtected) {
    const hasSession = request.cookies.has(SESSION_COOKIE_NAME)
    if (!hasSession) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('returnTo', pathname + request.nextUrl.search)
      return NextResponse.redirect(loginUrl)
    }
  }

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
