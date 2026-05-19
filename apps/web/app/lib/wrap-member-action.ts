/**
 * `wrapMemberAction()` — wrapper LogiFit-specific de Server Action **do portal do paciente**.
 *
 * Análogo a `wrapServerAction()` (staff) mas pra session do paciente:
 *   - `requireMemberSession()` em vez de `requireFullSession()` (cookie próprio
 *     `lf_member_session`, separação clara ADR 0088).
 *   - `withMemberContext()` em vez de `withSessionContext()` (seta
 *     `app.tenant_id` + `app.member_id` em vez de `app.tenant_id` + `app.user_id`).
 *   - **Não tem MFA gate** (member portal não usa MFA por padrão Sprint 26).
 *   - **Audit log automático** em `member_events` quando `ctx.eventKind` passado
 *     (Sprint 02d3). `actor_user_id = NULL` distingue de staff actions.
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
 *       eventKind: 'meu.appointment.cancelled', // grava audit em member_events
 *     },
 *     async (input, { session }) => {
 *       // app.tenant_id + app.member_id já setados (RLS aplica)
 *       // session.memberId, session.tenantId, session.sessionId disponíveis
 *     },
 *   )
 */
import { wrapAction, type WrapActionContext } from '@repo/errors'
import { memberEvents } from '@repo/db/schema'
import { db } from '@repo/db/client'
import { z, type ZodTypeAny } from 'zod'
import {
  type MemberSessionClaims,
  requireMemberSession,
  withMemberContext,
} from './member-session'

/**
 * Kinds canônicos de evento do member portal (Sprint 02d3).
 * Mantido em sincronia com `member_event_kind` enum (migration 0043).
 */
export type MemberPortalEventKind =
  | 'meu.appointment.cancelled'
  | 'meu.session.revoked'
  | 'meu.consent.updated'
  | 'meu.cross_prescription_alert.acknowledged'
  | 'meu.incident.acknowledged'
  | 'meu.cross_tenant_access.exported'
  | 'meu.exam.self_uploaded'
  | 'meu.device.connected'
  | 'meu.device.disconnected'
  | 'meu.device.consent_granted'
  | 'meu.device.consent_revoked'
  | 'meu.device.csv_imported'
  | 'meu.diary.meal_logged'
  | 'meu.diary.meal_deleted'
  | 'meu.mobile.push_token_registered'
  | 'meu.mobile.push_token_revoked'

interface WrapMemberActionContextBase extends WrapActionContext {
  /** Nome canônico (ex: 'appointment.cancel'). Vai pra logging/observabilidade. */
  action: string
  /** Path pra redirect caso member session falte (default: '/meu/login'). */
  returnTo?: string
  /** Tipo do recurso afetado (audit context — Sprint 02c2 conecta member_events). */
  resourceType?: string
  /**
   * Kind do evento canônico a gravar em `member_events` após handler success
   * (Sprint 02d3 audit log automático). Quando omitido, não grava — usar pra
   * actions read-only (`listMyExams`, `listMyConnections`, etc) que não mudam estado.
   */
  eventKind?: MemberPortalEventKind
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
  /** Adiciona payload extra ao audit `member_events` (handler decide). */
  setAuditPayload: (payload: Record<string, unknown>) => void
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

      // 3. Audit context — handler pode injetar payload extra
      let auditExtraPayload: Record<string, unknown> = {}
      const setAuditPayload = (payload: Record<string, unknown>) => {
        auditExtraPayload = payload
      }

      // 4. Roda handler com member context (RLS via app.tenant_id + app.member_id)
      const data = await withMemberContext(session, async () => {
        return handler(args, { session, setAuditPayload })
      })

      // 5. Audit member_events fire-and-forget (não falha o request se audit falhar)
      //    Só grava quando ctx.eventKind passado (read-only actions omitem).
      //    `actor_user_id = NULL` distingue de staff (Sprint 02 Faixa A).
      if (ctx.eventKind) {
        void writeMemberEvent({
          tenantId: session.tenantId,
          memberId: session.memberId,
          kind: ctx.eventKind,
          payload: {
            action: ctx.action,
            session_id: session.sessionId,
            ...sanitizeArgs(args),
            ...auditExtraPayload,
          },
        }).catch((err) => {
          console.error(
            '[wrapMemberAction] member_events insert falhou:',
            err instanceof Error ? err.message : err,
          )
        })
      }

      return data
    },
  )
}

interface WriteMemberEventPayload {
  tenantId: string
  memberId: string
  kind: MemberPortalEventKind
  payload: Record<string, unknown>
}

async function writeMemberEvent(p: WriteMemberEventPayload): Promise<void> {
  // RLS via app.tenant_id + app.member_id já setados dentro de withMemberContext
  // — mas writeMemberEvent é chamado FORA do withMemberContext (após handler).
  // Como member_events tem trigger append-only e RLS por tenant, precisamos
  // re-setar contexto. Atualmente Sprint 02d3 usa db.insert direto (sem RLS-aware
  // re-set) — Sprint 02d4 conectará com `withMemberContext` se RLS bloqueio
  // aparecer em prod.
  await db.insert(memberEvents).values({
    tenantId: p.tenantId,
    memberId: p.memberId,
    actorUserId: null, // member portal — paciente é actor (não staff user)
    kind: p.kind,
    payload: p.payload,
  })
}

/**
 * Sanitiza args antes de gravar em member_events.payload — remove campos
 * sensíveis. Mesmo padrão do wrapServerAction `sanitizeArgs`.
 */
function sanitizeArgs(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {}
  if (typeof args !== 'object') return { value: args }
  const PII_KEYS = new Set([
    'password',
    'passwordHash',
    'totpSecret',
    'recoveryCode',
    'token',
    'codeHash',
  ])
  const PII_TRUNCATE = new Set(['document', 'cpf', 'phone', 'email'])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (PII_KEYS.has(k)) {
      out[k] = '[REDACTED]'
    } else if (PII_TRUNCATE.has(k) && typeof v === 'string') {
      out[k] = `${v.slice(0, 3)}***${v.slice(-2)}`
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitizeArgs(v)
    } else {
      out[k] = v
    }
  }
  return out
}

// Re-export útil pro caller declarar schemas inline
export { z }
