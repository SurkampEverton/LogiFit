/**
 * Sentry/GlitchTip client config — browser runtime.
 *
 * Carregado automaticamente pelo `@sentry/nextjs` via `next.config.ts`
 * `withSentryConfig`. Sem `NEXT_PUBLIC_SENTRY_DSN`, `init` no-op (call
 * `Sentry.captureException` em outros lugares vira no-op também).
 *
 * Tags canônicas do LogiFit (regras 33 + ADR 0073):
 *   - `tenant_id`, `request_id`, `module`, `action` — setadas em runtime
 *     pelos wrappers `wrap-action` / `wrap-api-handler` quando ativados
 *
 * Sample rate baixo em prod (0.1 = 10%) — server-side caputera tudo,
 * client-side só amostra pra reduzir noise.
 */
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',
    // tracesSampleRate baixo em prod — performance monitoring sem custo absurdo
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // GlitchTip não suporta Replay nativo — desligado pra evitar 404 no upload
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    // Não enviar PII automaticamente; wrappers passam payloads já sanitizados
    sendDefaultPii: false,
    // Ignora ruído conhecido de browser
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  })
}
