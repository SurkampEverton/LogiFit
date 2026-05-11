import { expect, test } from '@playwright/test'

/**
 * smoke/security-headers — todos os 8 headers da regra 35 + ADR 0073 presentes.
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Este é o ÚNICO smoke que pode rodar DESDE Sprint 00 (já temos /, /seguranca,
 * /.well-known/security.txt em prod). Demais smoke ficam skip até Sprint 01a+.
 *
 * Cobre regra 35: HSTS preload, CSP com nonce dinâmico, XFO DENY, nosniff,
 * Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy restritiva,
 * COOP same-origin, CORP same-site.
 */
const EXPECTED_HEADERS = [
  ['strict-transport-security', 'max-age=63072000; includeSubDomains; preload'],
  ['x-frame-options', 'DENY'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['cross-origin-opener-policy', 'same-origin'],
  ['cross-origin-resource-policy', 'same-site'],
] as const

test('rota / retorna 8/8 security headers + CSP nonce dinâmico', async ({ request }) => {
  const res = await request.get('/')
  expect(res.status()).toBe(200)

  for (const [name, expected] of EXPECTED_HEADERS) {
    expect(res.headers()[name], `header ${name}`).toBe(expected)
  }

  // CSP: presente + nonce dinâmico (não vazio) + sem 'unsafe-inline' em script-src
  const csp = res.headers()['content-security-policy']
  expect(csp, 'CSP presente').toBeDefined()
  expect(csp).toMatch(/script-src[^;]+'nonce-[A-Za-z0-9+/=]+'/)
  expect(csp).toMatch(/script-src[^;]+'strict-dynamic'/)
  expect(csp).not.toMatch(/script-src[^;]+'unsafe-inline'/)

  // Permissions-Policy restritiva — sensíveis em 'self' apenas
  const pp = res.headers()['permissions-policy']
  expect(pp).toMatch(/camera=\(self\)/)
  expect(pp).toMatch(/microphone=\(self\)/)
  expect(pp).toMatch(/geolocation=\(self\)/)
})

test('CSP nonce muda entre requests (dinâmico — não cacheado)', async ({ request }) => {
  const r1 = await request.get('/')
  const r2 = await request.get('/')

  const nonce1 = r1.headers()['x-nonce']
  const nonce2 = r2.headers()['x-nonce']

  expect(nonce1, 'x-nonce presente em r1').toBeDefined()
  expect(nonce2, 'x-nonce presente em r2').toBeDefined()
  expect(nonce1, 'nonces devem ser distintos').not.toBe(nonce2)
})

test('/.well-known/security.txt expõe contato + canonical (RFC 9116)', async ({ request }) => {
  const res = await request.get('/.well-known/security.txt')
  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).toMatch(/^Contact: mailto:security@logifit\.com\.br$/m)
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}/m)
  expect(body).toMatch(/^Canonical: https:\/\/logifit\.com\.br\/\.well-known\/security\.txt$/m)
  expect(body).toMatch(/^Policy: https:\/\/logifit\.com\.br\/seguranca$/m)
})
