/**
 * `wrapMemberAction()` — wrapper LogiFit-specific de Server Action **do portal do paciente**.
 *
 * Análogo a `wrapServerAction()` (staff) mas pra session do paciente:
 *   - `requireMemberSession()` em vez de `requireFullSession()` (cookie próprio
 *     `lf_member_session`, separação clara ADR 0088).
 *   - `withMemberContext()` em vez de `withSessionContext()` (seta
 *     `app.tenant_id` + `app.member_id` em vez de `app.tenant_id` + `app.user_id`).
 *   - **Não tem MFA gate** (member portal não usa MFA por padrão Sprint 26).
 *   - **Não escreve em audit_log do staff** (audit do paciente vive em
 *     `member_events` + `patient_data_access_log` quando aplicável).
 *   - **Envelope via `wrapAction`** mesmo padrão `{ ok, data } | { ok: false, error }`.
 *   - **Zod validation built-in** via `schema` no context (opcional — caller
 *     pode passar input já parseado se quiser).
 *
 * **Lint custom `no-unwrapped-action`** (scripts/lint-custom.mjs) reconhece
 * tanto `wrapServerAction(` (staff) quanto `wrapMemberAction(` (member portal)
 * via regex `\bwrap(?:Server|Member)?Action\s*\(/`.
 *
 * Uso típico:
 *   export const cancelMyAppointment = wrapMemberAction(
 *     {
 *       module: 'meu.agenda',
 *       action: 'appointment.cancel',
 *       returnTo: '/meu/agenda',
 *       schema: CancelSchema,
 *     },
 *     async (input, { session }) => {
 *       // app.tenant_id + app.member_id já setados (RLS aplica)
 *       // session.memberId, session.tenantId, session.sessionId disponíveis
 *     },
 *   )
 */
import { wrapAction, type WrapActionContext } from '@repo/errors'
import { z, type ZodTypeAny } from 'zod'
import {
  type MemberSessionClaims,
  requireMemberSession,
  withMemberContext,
} from './member-session'

interface WrapMemberActionContextBase extends WrapActionContext {
  /** Nome canônico (ex: 'appointment.cancel'). Vai pra logging/observabilidade. */
  action: string
  /** Path pra redirect caso member session falte (default: '/meu/login'). */
  returnTo?: string
  /** Tipo do recurso afetado (audit context — Sprint 02c2 conecta member_events). */
  resourceType?: string
}

export interface WrapMemberActionContext<TSchema extends ZodTypeAny>
  extends WrapMemberActionContextBase {
  /** Zod schema do input — quando passado, valida antes do handler.
   * Caller recebe input já tipado e validado via `z.infer<TSchema>`. */
  schema: TSchema
}

export interface WrapMemberActionContextNoSchema extends WrapMemberActionContextBase {
  schema?: undefined
}

export interface WrappedMemberActionContext {
  /** Claims do paciente — memberId, tenantId, sessionId, vertical. */
  session: MemberSessionClaims
}

/**
 * Cria Server Action do portal do paciente.
 *
 * Overload 1: com schema Zod — caller recebe input tipado via z.infer<TSchema>
 * Overload 2: sem schema — caller recebe input do tipo declarado no handler
 *
 * @returns Server Action que retorna envelope ADR 0071 `{ ok, data } | { ok: false, error }`
 */
export function wrapMemberAction<TSchema extends ZodTypeAny, TData>(
  ctx: WrapMemberActionContext<TSchema>,
  handler: (
    input: z.infer<TSchema>,
    wrapped: WrappedMemberActionContext,
  ) => Promise<TData>,
): (rawInput: z.infer<TSchema>) => Promise<TData>
export function wrapMemberAction<TArgs, TData>(
  ctx: WrapMemberActionContextNoSchema,
  handler: (input: TArgs, wrapped: WrappedMemberActionContext) => Promise<TData>,
): (rawInput: TArgs) => Promise<TData>
export function wrapMemberAction(
  ctx: WrapMemberActionContextBase & { schema?: ZodTypeAny },
  handler: (input: unknown, wrapped: WrappedMemberActionContext) => Promise<unknown>,
) {
  return wrapAction(
    { module: ctx.module, requires: ctx.requires, rateLimitKey: ctx.rateLimitKey },
    async (rawArgs: unknown) => {
      // 1. Valida input via Zod (opcional)
      const args = ctx.schema ? ctx.schema.parse(rawArgs) : rawArgs

      // 2. Session do paciente (redirect /meu/login se falta)
      const session = await requireMemberSession(ctx.returnTo ?? '/meu/login')

      // 3. Roda handler com member context (RLS via app.tenant_id + app.member_id)
      return await withMemberContext(session, async () => {
        return handler(args, { session })
      })
    },
  )
}

// Re-export útil pro caller declarar schemas inline
export { z }
