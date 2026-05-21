/**
 * Sentry/GlitchTip edge config — Edge runtime (middleware).
 *
 * Carregado por `instrumentation.ts` quando `NEXT_RUNTIME === 'edge'`.
 * Sem `SENTRY_DSN` (ou fallback `NEXT_PUBLIC_*`), no-op.
 *
 * Edge runtime tem APIs limitadas (sem Node `process`, `crypto.randomUUID()`
 * só via globalThis) — config minimalista.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  })
}
