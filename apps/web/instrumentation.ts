/**
 * Next.js 15 instrumentation hook — entrypoint pra observabilidade runtime
 * (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 *
 * Carrega configs Sentry/GlitchTip por runtime (`nodejs` vs `edge`).
 * Sem DSN env (`NEXT_PUBLIC_SENTRY_DSN`), todas as chamadas viram no-op —
 * dev local roda sem capturar nada.
 *
 * Servidor GlitchTip self-host em `https://errors.logifit.com.br` (Sprint 00 Faixa 3).
 * Criar projeto no painel → copiar DSN → setar `NEXT_PUBLIC_SENTRY_DSN` em
 * `.env.local` (dev) ou env var Coolify (prod).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// `onRequestError` (Next.js 15.3+ hook) chega via `@sentry/nextjs` em
// versões recentes. Se a versão instalada exportar, plugar:
// export { onRequestError } from '@sentry/nextjs'
// Sem isso, errors em request handlers ainda são capturados via
// `setCaptureHook` dos wrappers @repo/errors (path mais granular do que
// onRequestError, que captura tudo cego).
