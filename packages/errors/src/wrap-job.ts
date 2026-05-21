/**
 * wrapJob — wrapper canônico de jobs assíncronos (cron, queue worker).
 * Sem retorno de Response — só log + alert + retry (TODO).
 *
 * Sprint 00: scaffolding. Sprint 01a integra retry + queue real.
 */
import { ApiException } from './api-error'
import { captureFromBoundary } from './capture'
import { fingerprint } from './fingerprint'
import { logBoundaryError } from './logger'
import { translate } from './translators'

const CAPTURE_CODES = new Set([
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'AI_PROVIDER_ERROR',
])

export interface WrapJobContext {
  module: string
  jobName: string
  /** Tentativas antes de desistir — implementação real Sprint 01a (queue). */
  maxAttempts?: number
}

type JobHandler<TArgs> = (args: TArgs) => Promise<void>

export function wrapJob<TArgs>(
  ctx: WrapJobContext,
  handler: JobHandler<TArgs>,
): (args: TArgs) => Promise<void> {
  return async (args: TArgs) => {
    const requestId = globalThis.crypto.randomUUID()
    try {
      await handler(args)
    } catch (e) {
      const errorPayload =
        e instanceof ApiException
          ? { code: e.code, message: e.message }
          : (() => {
              const partial = translate(e, { request_id: requestId, module: ctx.module })
              return { code: partial.code, message: partial.message }
            })()

      // TODO Faixa 3: GlitchTip capture
      // TODO Sprint 01a: insert system_alerts + retry com backoff exponencial
      const jobFingerprint = fingerprint({
        code: errorPayload.code,
        module: ctx.module,
        signal: ctx.jobName,
      })
      logBoundaryError({
        job: ctx.jobName,
        request_id: requestId,
        module: ctx.module,
        code: errorPayload.code,
        fingerprint: jobFingerprint,
        message: errorPayload.message,
      })
      if (CAPTURE_CODES.has(errorPayload.code)) {
        captureFromBoundary(e, {
          level: 'error',
          tags: {
            job: ctx.jobName,
            module: ctx.module,
            request_id: requestId,
            code: errorPayload.code,
            fingerprint: jobFingerprint,
          },
          extra: { message: errorPayload.message },
        })
      }
      throw e
    }
  }
}
