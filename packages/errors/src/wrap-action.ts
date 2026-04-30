/**
 * wrapAction — wrapper canônico de Server Actions (ADR 0071 + regra 33).
 *
 * Sprint 00: shape do wrapper definido + tradução de erro + fingerprint + log
 * estruturado. Hooks de auth/permissions/rate-limit/audit/alerts/GlitchTip
 * ficam como TODOs até as deps existirem (auth Sprint 01a; rate-limit Faixa 3;
 * audit/alerts Sprint 01a; GlitchTip Faixa 3).
 *
 * Quando completos, todo Server Action DEVE passar por wrapAction. Lint custom
 * `no-unwrapped-action` (Faixa 4) bloqueia commit caso contrário.
 */
import { ApiException, type ApiResult, err, ok } from './api-error'
import { fingerprint } from './fingerprint'
import { translate } from './translators'

export interface WrapActionContext {
  /** Identifica o módulo (ex: 'agenda', 'financeiro.invoice') pra logging/alerts. */
  module: string
  /** Permissões RBAC requeridas (Sprint 01b). */
  requires?: string[]
  /** Gate de Comitê IA SaMD II+ (regra 28 — ativado no Sprint 06). */
  requiresAiCommittee?: boolean
  /** Gate de consent LGPD (regra 29 — ativado no Sprint 20+). */
  requiresConsent?: string[]
  /** Gate de MFA recente <15min (regra 43 — Sprint 01a integra). */
  requiresRecentMfa?: boolean
  /** Override de chave de rate limit. Default: `${module}:${userId ?? ip}`. */
  rateLimitKey?: string
}

type ActionHandler<TArgs, TData> = (args: TArgs) => Promise<TData>

export function wrapAction<TArgs, TData>(
  ctx: WrapActionContext,
  handler: ActionHandler<TArgs, TData>,
): (args: TArgs) => Promise<ApiResult<TData>> {
  return async (args: TArgs) => {
    const requestId = globalThis.crypto.randomUUID()
    try {
      // TODO Sprint 01a: auth check + tenant scope (RLS via set_config)
      // TODO Sprint 01b: permissions (ctx.requires) + consent (ctx.requiresConsent)
      // TODO Sprint 01a: requireRecentMfa() se ctx.requiresRecentMfa
      // TODO Faixa 3: rate limit Redis sliding window (ctx.rateLimitKey)
      // TODO Sprint 06: gate Comitê IA se ctx.requiresAiCommittee

      const data = await handler(args)
      return ok(data)
    } catch (e) {
      if (e instanceof ApiException) {
        return err({
          code: e.code,
          message: e.message,
          request_id: requestId,
          runbook: e.runbook,
          retry_after_ms: e.retry_after_ms,
          details: e.details,
          fingerprint: fingerprint({ code: e.code, module: ctx.module, signal: e.message }),
        })
      }

      const partial = translate(e, { request_id: requestId, module: ctx.module })
      const error = {
        ...partial,
        fingerprint: fingerprint({
          code: partial.code,
          module: ctx.module,
          signal: partial.message,
        }),
      }

      // TODO Faixa 3: GlitchTip capture pra INTERNAL_ERROR/AI_PROVIDER_ERROR
      // TODO Sprint 01a: insert system_alerts (async, fire-and-forget)
      // TODO Sprint 01a: append audit_log (regra 5 + 39 hash chain)

      console.error(
        JSON.stringify({
          level: 'error',
          request_id: requestId,
          module: ctx.module,
          code: error.code,
          fingerprint: error.fingerprint,
          message: error.message,
        }),
      )
      return err(error)
    }
  }
}
