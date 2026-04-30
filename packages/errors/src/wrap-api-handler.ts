/**
 * wrapApiHandler — wrapper canônico de API Routes (ADR 0071 + regra 33).
 * Mesmo shape do wrapAction, mas devolve Response em vez de ApiResult.
 * Status HTTP derivado do código do erro.
 */
import { ApiException, type ApiErrorCode } from './api-error'
import { fingerprint } from './fingerprint'
import { translate } from './translators'

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  AI_QUOTA_EXCEEDED: 429,
  AI_PROVIDER_ERROR: 502,
  PAYMENT_FAILED: 402,
  FISCAL_REJECTED: 422,
  CONSENT_REQUIRED: 451,
  COMMITTEE_REQUIRED: 451,
  SLUG_TAKEN: 409,
  TENANT_SUSPENDED: 402,
}

export interface WrapApiContext {
  module: string
}

type ApiHandler = (request: Request) => Promise<Response>

export function wrapApiHandler(ctx: WrapApiContext, handler: ApiHandler): ApiHandler {
  return async (request: Request) => {
    const requestId = request.headers.get('x-request-id') ?? globalThis.crypto.randomUUID()
    try {
      const response = await handler(request)
      response.headers.set('x-request-id', requestId)
      return response
    } catch (e) {
      const errorPayload =
        e instanceof ApiException
          ? {
              code: e.code,
              message: e.message,
              request_id: requestId,
              runbook: e.runbook,
              retry_after_ms: e.retry_after_ms,
              details: e.details,
              fingerprint: fingerprint({
                code: e.code,
                module: ctx.module,
                signal: e.message,
              }),
            }
          : (() => {
              const partial = translate(e, { request_id: requestId, module: ctx.module })
              return {
                ...partial,
                fingerprint: fingerprint({
                  code: partial.code,
                  module: ctx.module,
                  signal: partial.message,
                }),
              }
            })()

      console.error(
        JSON.stringify({
          level: 'error',
          request_id: requestId,
          module: ctx.module,
          code: errorPayload.code,
          fingerprint: errorPayload.fingerprint,
          message: errorPayload.message,
        }),
      )

      const headers: Record<string, string> = { 'x-request-id': requestId }
      if (errorPayload.retry_after_ms !== undefined) {
        headers['retry-after'] = String(Math.ceil(errorPayload.retry_after_ms / 1000))
      }

      return Response.json(
        { ok: false, error: errorPayload },
        { status: HTTP_STATUS[errorPayload.code], headers },
      )
    }
  }
}
