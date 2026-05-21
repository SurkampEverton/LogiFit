/**
 * Resolve sender (from/replyTo) por categoria — [ADR 0097](../../../docs/decisions/0097-email-sender-categoria-branding-por-tier.md).
 *
 * **MVP (este arquivo):**
 * - Categoria `platform` — SEMPRE `EMAIL_FROM` + `EMAIL_FROM_NAME` do env (LogiFit)
 * - Categoria `tenant` — fallback puro por ora (`from = LogiFit` + `replyTo` se fornecido)
 *
 * **Futuro (sprint dedicado pós-schema `tenant_email_settings`):**
 * - Categoria `tenant` — consultar `tenant_email_settings.verification_status`:
 *   - `verified` + Pro+ → usa `from_domain` real do tenant
 *   - `fallback` (Solo/Starter ou não verificado) → fallback LogiFit + `Reply-To: tenant.contact_email`
 *   - White-label Enterprise → + `signature_html` + per-unit overrides
 *
 * Sem dependência de DB hoje — função pura sobre env + input. Quando schema vier,
 * esta função vira async + recebe `getTenantEmailSettings(tenantId)` injetado.
 */

import type { ResolvedSender, SendTransactionalInput } from './types'

const DEFAULT_FROM = 'no-reply@logifit.com.br'
const DEFAULT_FROM_NAME = 'LogiFit'

export function resolveEmailSender(input: SendTransactionalInput): ResolvedSender {
  const platformFrom = process.env.EMAIL_FROM ?? DEFAULT_FROM
  const platformFromName = process.env.EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME

  if (input.category === 'platform') {
    return {
      fromEmail: platformFrom,
      fromName: platformFromName,
      replyTo: input.replyTo,
    }
  }

  // category === 'tenant'
  // MVP — sem schema tenant_email_settings ainda; fallback LogiFit + replyTo opcional
  // do caller. Quando o schema for criado (sprint dedicado), evoluir esta branch pra
  // consultar tenant_email_settings via getTenantEmailSettings(input.tenantId).
  if (!input.tenantId) {
    throw new Error(
      "[email] resolveEmailSender: category='tenant' requires tenantId (ADR 0097)",
    )
  }

  return {
    fromEmail: platformFrom,
    // Display name composto pra UX: "Clínica Vital via LogiFit" — quando schema vier,
    // o "Clínica Vital" sai de tenant_email_settings.display_name; por ora fica
    // genérico até o caller poder injetar. Caller pode passar replyTo do tenant.
    fromName: platformFromName,
    replyTo: input.replyTo,
  }
}
