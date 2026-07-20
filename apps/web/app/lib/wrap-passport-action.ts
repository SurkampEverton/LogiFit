/**
 * `wrapPassportAction()` — wrapper LogiFit-specific de Server Action **da identidade global do paciente**.
 *
 * Análogo a `wrapMemberAction()` (member portal Sprint 26) mas pra session
 * de paciente passport (ADR 0094):
 *   - `requirePassportSession()` em vez de `requireMemberSession()` (cookie próprio
 *     `lf_passport_session`, separação clara ADR 0094).
 *   - `withPassportContext()` em vez de `withMemberContext()` (seta
 *     `app.passport_global_id` em vez de `app.tenant_id` + `app.member_id`).
 *   - **Opt-in MFA gate** via `requireMfa` no context — quando true, exige
 *     `mfa_verified_at` recente (default 15min — espelha staff regra 43).
 *   - **Envelope via `wrapAction`** mesmo padrão `{ ok, data } | { ok: false, error }`.
 *   - **Zod validation built-in** via `schema` no context (opcional).
 *
 * **Lint custom `no-unwrapped-action`** (scripts/lint-custom.mjs) reconhece
 * `wrapServerAction(`, `wrapMemberAction(` e `wrapPassportAction(` via regex
 * `\bwrap(?:Server|Member|Passport)?Action\s*\(/`.
 *
 * Uso típico:
 *   export const updatePassportEmail = wrapPassportAction(
 *     {
 *       module: 'meu.perfil',
 *       action: 'email.update',
 *       returnTo: '/meu/perfil',
 *       schema: UpdateEmailSchema,
 *       requireMfa: true,  // ação sensível — exige TOTP recente <15min
 *     },
 *     async (input, { session }) => {
 *       // app.passport_global_id já setado (RLS aplica)
 *       // session.passportGlobalId, session.sessionId, session.mfaVerifiedAt
 *     },
 *   )
 */
import { type WrapActionContext, wrapAction } from '@repo/errors'
import { type ZodTypeAny, z } from 'zod'
import {
  type PassportSessionClaims,
  requirePassportMfa,
  requirePassportSession,
  withPassportContext,
} from './passport-session'

interface WrapPassportActionContextBase extends WrapActionContext {
  /** Nome canônico (ex: 'email.update'). Vai pra logging/observabilidade. */
  action: string
  /** Path pra redirect caso passport session falte (default: '/meu/login'). */
  returnTo?: string
  /** Tipo do recurso afetado (audit context — Sprint 02b4 conecta passport_audit_log). */
  resourceType?: string
  /**
   * Quando `true`, exige `mfa_verified_at` recente na session (default 15min).
   * Use pra ações sensíveis: trocar email/senha/recovery codes, desativar conta,
   * exportar dados LGPD art. 18 V.
   *
   * Análogo a staff `HIGH_RISK_ACTIONS` (regra 43) mas decisão é caller-explícita
   * em vez de tabela canônica — paciente tem menos high-risk surfaces.
   */
  requireMfa?: boolean
  /**
   * Janela MFA em ms (default 15min). Reduza pra ações ultra-sensíveis
   * (ex: alterar identidade — 5min).
   */
  mfaMaxAgeMs?: number
}

export interface WrapPassportActionContext<TSchema extends ZodTypeAny>
  extends WrapPassportActionContextBase {
  /** Zod schema do input — quando passado, valida antes do handler.
   * Caller recebe input já tipado e validado via `z.infer<TSchema>`. */
  schema: TSchema
}

export interface WrapPassportActionContextNoSchema extends WrapPassportActionContextBase {
  schema?: undefined
}

export interface WrappedPassportActionContext {
  /** Claims do paciente passport — passportGlobalId, sessionId, mfaVerifiedAt. */
  session: PassportSessionClaims
}

/**
 * Cria Server Action da identidade global passport.
 *
 * Overload 1: com schema Zod — caller recebe input tipado via z.infer<TSchema>
 * Overload 2: sem schema — caller recebe input do tipo declarado no handler
 *
 * @returns Server Action que retorna envelope ADR 0071 `{ ok, data } | { ok: false, error }`
 */
export function wrapPassportAction<TSchema extends ZodTypeAny, TData>(
  ctx: WrapPassportActionContext<TSchema>,
  handler: (input: z.infer<TSchema>, wrapped: WrappedPassportActionContext) => Promise<TData>,
): (rawInput: z.infer<TSchema>) => Promise<TData>
export function wrapPassportAction<TArgs, TData>(
  ctx: WrapPassportActionContextNoSchema,
  handler: (input: TArgs, wrapped: WrappedPassportActionContext) => Promise<TData>,
): (rawInput: TArgs) => Promise<TData>
export function wrapPassportAction(
  ctx: WrapPassportActionContextBase & { schema?: ZodTypeAny },
  handler: (input: unknown, wrapped: WrappedPassportActionContext) => Promise<unknown>,
) {
  return wrapAction(
    { module: ctx.module, requires: ctx.requires, rateLimitKey: ctx.rateLimitKey },
    async (rawArgs: unknown) => {
      // 1. Valida input via Zod (opcional)
      const args = ctx.schema ? ctx.schema.parse(rawArgs) : rawArgs

      // 2. Session passport (redirect /meu/login se falta)
      const session = await requirePassportSession(ctx.returnTo ?? '/meu/login')

      // 3. MFA gate quando requireMfa=true
      if (ctx.requireMfa) {
        requirePassportMfa(session, ctx.mfaMaxAgeMs)
      }

      // 4. Roda handler com passport context (RLS via app.passport_global_id)
      return await withPassportContext(session, async () => {
        return handler(args, { session })
      })
    },
  )
}

// Re-export útil pro caller declarar schemas inline
export { z }
