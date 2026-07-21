import { db } from '@repo/db/client'
import { auditLog } from '@repo/db/schema'
/**
 * `wrapServerAction()` — wrapper LogiFit-specific de Server Action (Sprint 01a Faixa F).
 *
 * **Não usa `'use server'` no topo** — este é um helper *de fábrica* (retorna
 * outra função). Os arquivos que **usam** `wrapServerAction` (ex.: `app/app/
 * pessoas/actions.ts`) têm `'use server'` no topo, marcando as funções
 * retornadas como Server Actions. Next.js exige que todos exports de arquivo
 * `'use server'` sejam Server Actions async-only — não cabem helpers.
 *
 * Compose:
 *   1. `requireFullSession()` — garante user + tenant claims (redirect /login se falta)
 *   2. `requireRecentMfaForAction()` se action listada em HIGH_RISK_ACTIONS (regra 43)
 *   3. `withSessionContext()` — seta `app.tenant_id` + `app.user_id` na conexão (RLS aplica)
 *   4. Roda handler dentro do envelope `@repo/errors/wrapAction` (ADR 0071)
 *   5. Insere audit_log fire-and-forget (regra 5 + hash chain regra 39)
 *
 * Versão base agnóstica `wrapAction` em `@repo/errors` continua útil pra
 * jobs/CLI que não têm session (BetterAuth).
 *
 * **Lint custom `no-unwrapped-action`** (scripts/lint-custom.mjs) detecta
 * Server Actions sem chamar este helper → CI vermelho.
 *
 * Uso típico:
 *   export const createPerson = wrapServerAction(
 *     { module: 'persons', action: 'person.create' },
 *     async ({ input, session }) => { ... }
 *   )
 */
import { type WrapActionContext, wrapAction } from '@repo/errors'
import { requireRecentMfaForAction } from '@repo/security'
import { type LogifitSessionClaims, requireFullSession, withSessionContext } from './session'

export interface WrapServerActionContext extends WrapActionContext {
  /** Nome canônico da ação no namespace 'resource.verb' (ex: 'person.create').
   * Usado em audit_log.action + lookup HIGH_RISK_ACTIONS pra MFA gate. */
  action: string
  /** Path pra redirect caso sessão falhe (default: '/login'). */
  returnTo?: string
  /** Tipo do recurso afetado (audit_log.resource_type). Opcional. */
  resourceType?: string
}

export interface WrappedActionContext {
  /** Sessão validada (logifit claims garantidos). */
  session: { logifit: LogifitSessionClaims; user: { id: string; email: string } }
  /** Resource ID a registrar em audit_log (handler seta via `setAuditResource`). */
  setAuditResource: (resourceId: string, extraPayload?: Record<string, unknown>) => void
}

type Handler<TArgs, TData> = (args: TArgs, ctx: WrappedActionContext) => Promise<TData>

export function wrapServerAction<TArgs, TData>(
  ctx: WrapServerActionContext,
  handler: Handler<TArgs, TData>,
) {
  // Compose com wrapAction base (envelope ADR 0071)
  return wrapAction(
    { module: ctx.module, requires: ctx.requires, rateLimitKey: ctx.rateLimitKey },
    async (args: TArgs) => {
      // 1. Sessão (com claims LogiFit)
      const session = await requireFullSession(ctx.returnTo ?? '/login')

      // 2. MFA gate se action é high-risk (regra 43)
      // Throw MfaRecentRequiredError → translator de @repo/errors mapeia pra envelope
      requireRecentMfaForAction(
        { mfaAt: session.logifit.mfaAt, authUserId: session.user.id },
        ctx.action,
      )

      // 3. Audit context — handler injeta resource_id se quiser
      let auditResourceId: string | null = null
      let auditExtraPayload: Record<string, unknown> = {}
      const setAuditResource = (resourceId: string, extra?: Record<string, unknown>) => {
        auditResourceId = resourceId
        if (extra) auditExtraPayload = extra
      }

      // 4. Roda handler com session context (RLS via app.tenant_id)
      const data = await withSessionContext(session.logifit, async () => {
        return handler(args, {
          session: {
            logifit: session.logifit,
            user: { id: session.user.id, email: session.user.email },
          },
          setAuditResource,
        })
      })

      // 5. Audit log fire-and-forget (não falha o request se audit falhar)
      //    RLS via app.tenant_id já está setado dentro do withSessionContext.
      void writeAuditLog({
        tenantId: session.logifit.tenantId,
        actorUserId: session.logifit.userId,
        actorAuthUserId: session.user.id,
        action: ctx.action,
        resourceType: ctx.resourceType ?? null,
        resourceId: auditResourceId,
        payload: { ...auditExtraPayload, args: sanitizeArgs(args) },
      }).catch((err) => {
        // GlitchTip capture (futuro) — por agora só log
        console.error('[audit_log] insert falhou:', err instanceof Error ? err.message : err)
      })

      return data
    },
  )
}

interface AuditWritePayload {
  tenantId: string
  actorUserId: string
  actorAuthUserId: string
  action: string
  resourceType: string | null
  resourceId: string | null
  payload: Record<string, unknown>
}

async function writeAuditLog(p: AuditWritePayload): Promise<void> {
  // Roda FORA do withSessionContext (fire-and-forget depois do handler), então
  // vai ao pool sem papel de app — escrita de sistema, sem RLS. É intencional:
  // o audit não pode depender do contexto da request que está encerrando.
  await db.insert(auditLog).values({
    tenantId: p.tenantId,
    actorAuthUserId: p.actorAuthUserId,
    actorUserId: p.actorUserId,
    action: p.action,
    resourceType: p.resourceType,
    resourceId: p.resourceId,
    payload: p.payload,
  })
}

/**
 * Sanitiza args antes de gravar em audit_log.payload — remove campos PII bruto.
 * Sprint 01a Faixa F: blacklist simples; Sprint 02+ adiciona allowlist por action.
 */
function sanitizeArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args
  if (typeof args !== 'object') return args
  const PII_KEYS = new Set([
    'password',
    'passwordHash',
    'totpSecret',
    'recoveryCode',
    'creditCard',
    'cardNumber',
    'cvv',
  ])
  const PII_TRUNCATE = new Set(['document', 'cpf', 'cnpj'])
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
