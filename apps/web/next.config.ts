import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '../../')

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * Headers estáticos (regra 35 + ADR 0073). CSP é dinâmico (nonce por request)
 * — vive no middleware.ts em vez de aqui.
 */
const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(self), geolocation=(self), bluetooth=(self), payment=(self), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
]

const nextConfig: NextConfig = {
  // Standalone Next.js output pra Docker multi-stage (ADR 0091 — self-host).
  // outputFileTracingRoot aponta pra raiz do monorepo pra Next traçar workspaces.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // typedRoutes promovido de experimental → top-level em Next.js 15.5+
  typedRoutes: true,
  transpilePackages: [
    '@repo/ai',
    '@repo/auth',
    '@repo/cnpj',
    '@repo/db',
    '@repo/email',
    '@repo/errors',
    '@repo/i18n',
    '@repo/security',
    '@repo/storage',
    '@repo/types',
    '@repo/ui',
  ],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default withNextIntl(nextConfig)
