/**
 * Sentry/GlitchTip server config — Node runtime (Server Actions, API Routes, jobs).
 *
 * Carregado por `instrumentation.ts` quando `NEXT_RUNTIME === 'nodejs'`.
 * Sem `SENTRY_DSN` (server) ou `NEXT_PUBLIC_SENTRY_DSN` (fallback), no-op.
 *
 * Server captura tudo (sampleRate 1.0) — volume vai pro GlitchTip self-host
 * que tem armazenamento próprio.
 */
import * as Sentry from '@sentry/nextjs'
import { setCaptureHook } from '@repo/errors'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    // GlitchTip não suporta release tracking via upload de sourcemaps (Sentry-only)
    // — `release` aqui só rotula evento, sem upload.
    release: process.env.SENTRY_RELEASE ?? process.env.LF_SERVICE_VERSION,
  })

  // Conecta o capture hook do @repo/errors → Sentry/GlitchTip. Wrappers
  // (wrap-action / wrap-api-handler / wrap-job) chamam `captureFromBoundary`
  // pra códigos INTERNAL_ERROR / SERVICE_UNAVAILABLE / AI_PROVIDER_ERROR e o
  // hook delega pra Sentry com tags (tenant_id, module, request_id, code).
  setCaptureHook((err, context) => {
    Sentry.withScope((scope) => {
      if (context?.level) scope.setLevel(context.level)
      if (context?.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          if (value) scope.setTag(key, value)
        }
      }
      if (context?.extra) {
        for (const [key, value] of Object.entries(context.extra)) {
          scope.setExtra(key, value)
        }
      }
      Sentry.captureException(err)
    })
  })
}
