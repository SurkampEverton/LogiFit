/**
 * Capture hook injetável — desacopla `@repo/errors` de qualquer SDK específico
 * de observabilidade (Sentry/GlitchTip/etc).
 *
 * Por que injetável: `@repo/errors` é generic e roda em packages que não devem
 * importar `@sentry/nextjs` (que é Next-specific). O app boot (Next.js
 * `instrumentation.ts`) chama `setCaptureHook(Sentry.captureException)` e os
 * wrappers passam a capturar; sem isso, hook fica null e captura é no-op.
 *
 * Padrão de uso:
 *   // apps/web/instrumentation.ts (server runtime)
 *   import { setCaptureHook } from '@repo/errors'
 *   import * as Sentry from '@sentry/nextjs'
 *   setCaptureHook((err, context) => {
 *     Sentry.withScope((scope) => {
 *       if (context?.tags) scope.setTags(context.tags)
 *       Sentry.captureException(err)
 *     })
 *   })
 */

export interface CaptureContext {
  /** Tags Sentry-style: tenant_id, request_id, module, action, code. */
  tags?: Record<string, string | undefined>
  /** Extra context: payload sanitizado, fingerprint, etc. */
  extra?: Record<string, unknown>
  /** Severidade — wrappers passam 'error' por default. */
  level?: 'fatal' | 'error' | 'warning' | 'info'
}

export type CaptureHook = (err: unknown, context?: CaptureContext) => void

let currentHook: CaptureHook | null = null

/** App boot chama uma vez na inicialização. Idempotente — última chamada vence. */
export function setCaptureHook(hook: CaptureHook | null): void {
  currentHook = hook
}

/** Wrappers chamam pra capturar. No-op se nenhum hook setado. */
export function captureFromBoundary(err: unknown, context?: CaptureContext): void {
  if (!currentHook) return
  try {
    currentHook(err, context)
  } catch {
    // hook explodiu — ignora silenciosamente (não queremos perder o erro
    // original por culpa de bug no Sentry SDK)
  }
}
