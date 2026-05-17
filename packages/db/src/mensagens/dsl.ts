/**
 * DSL da régua declarativa — Sprint 13 Faixa B (ADR 0026).
 *
 * Zod schemas que validam `reguas.trigger`/`actions`/`stop_on`/`guards` JSONB
 * em runtime (no INSERT via Server Action `createRegua`).
 *
 * **5 eventos canônicos MVP**:
 *   - `invoice.overdue` (Sprint 04 financeiro)
 *   - `invoice.paid` (Sprint 04 — usado em stop_on)
 *   - `member.no_checkin_15d` (Sprint 08 access — reengajamento)
 *   - `lead.no_response_3d` (Sprint 10 vendas — follow-up)
 *   - `appointment.tomorrow` (Sprint 03 agenda — D-1 lembrete)
 *
 * Sprint 13+ adiciona: `stock.low_stock_alert` (Sprint 24), `lab_result.alert_raised`
 * (Sprint 30), `meal_plan.reminder` (Sprint 29), `appointment.checked_in`.
 *
 * **2 kinds de ação canônicos**:
 *   - `send_message` — channel + template_slug + delay_days
 *   - `wait` — delay puro (espera N dias antes da próxima ação)
 *
 * Sprint 13+ adiciona: `create_task` (operador humano), `webhook_call` (URL
 * externa via safeFetch), `branch` (condicional baseado em event payload).
 *
 * **Guards canônicos**:
 *   - `consent: 'marketing_messages' | 'transactional'` (default consent
 *     a verificar antes de enviar)
 *   - `rate_limit_per_member_24h: number` (max mensagens dessa régua a um
 *     member em 24h)
 *   - `hour_window: { from: '08:00', to: '20:00' }` (não enviar fora da janela)
 */
import { z } from 'zod'

// ─── Eventos canônicos ────────────────────────────────────────────────────

export const REGUA_EVENTS = [
  'invoice.overdue',
  'invoice.paid',
  'invoice.cancelled',
  'member.no_checkin_15d',
  'member.no_checkin_30d',
  'lead.no_response_3d',
  'appointment.tomorrow',
  'appointment.today',
  'workout.session_completed',
  'achievement.earned',
] as const

export type ReguaEvent = (typeof REGUA_EVENTS)[number]

// ─── Trigger ──────────────────────────────────────────────────────────────

export const TriggerSchema = z.object({
  event: z.enum(REGUA_EVENTS),
  /** Filtro opcional baseado em payload do evento (ex: days_overdue: [1,3,7]) */
  filter: z.record(z.unknown()).optional(),
})

// ─── Action ───────────────────────────────────────────────────────────────

export const ChannelEnum = z.enum(['whatsapp', 'email', 'sms'])

const SendMessageActionSchema = z.object({
  kind: z.literal('send_message'),
  channel: ChannelEnum,
  template_slug: z.string().min(1).max(80),
  /** Delay em dias antes desta ação (acumulativo desde started_at) */
  delay_days: z.number().int().nonnegative().max(365).default(0),
  /** Fallback de canal se primary falhar (ex: WhatsApp falha → email) */
  fallback_channel: ChannelEnum.optional(),
})

const WaitActionSchema = z.object({
  kind: z.literal('wait'),
  delay_days: z.number().int().positive().max(365),
})

export const ActionSchema = z.discriminatedUnion('kind', [
  SendMessageActionSchema,
  WaitActionSchema,
])

export const ActionsSchema = z.array(ActionSchema).min(1).max(20)

// ─── stop_on ──────────────────────────────────────────────────────────────

export const StopOnSchema = z.array(z.enum(REGUA_EVENTS)).optional()

// ─── Guards ───────────────────────────────────────────────────────────────

export const GuardsSchema = z
  .object({
    consent: z
      .enum(['marketing_messages', 'transactional', 'whatsapp_exchange'])
      .optional(),
    rate_limit_per_member_24h: z.number().int().positive().max(50).optional(),
    hour_window: z
      .object({
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/),
      })
      .optional(),
  })
  .optional()

// ─── Régua completa ───────────────────────────────────────────────────────

export const ReguaDslSchema = z.object({
  trigger: TriggerSchema,
  actions: ActionsSchema,
  stop_on: StopOnSchema,
  guards: GuardsSchema,
})

export type ReguaDsl = z.infer<typeof ReguaDslSchema>
export type ReguaAction = z.infer<typeof ActionSchema>
export type ReguaSendMessageAction = z.infer<typeof SendMessageActionSchema>
export type ReguaTrigger = z.infer<typeof TriggerSchema>
export type ReguaGuards = z.infer<typeof GuardsSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Calcula `next_action_at` somando os delays de todos os steps até o índice. */
export function nextActionAtFromSteps(
  startedAt: Date,
  actions: ReguaAction[],
  toStepIndex: number,
): Date | null {
  if (toStepIndex < 0 || toStepIndex >= actions.length) return null
  let totalDays = 0
  for (let i = 0; i <= toStepIndex; i++) {
    const action = actions[i]
    if (!action) return null
    if ('delay_days' in action) {
      totalDays += action.delay_days
    }
  }
  const next = new Date(startedAt.getTime())
  next.setUTCDate(next.getUTCDate() + totalDays)
  return next
}

/** Renderiza template `Olá {{member.name}}, sua fatura de {{invoice.amount}}...` */
export function renderTemplate(
  body: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const v = variables[key]
    if (v === null || v === undefined) return ''
    return String(v)
  })
}

/** Lista variáveis declaradas em `{{...}}` num body — usado em validação. */
export function extractTemplateVariables(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (m[1]) found.add(m[1])
  }
  return Array.from(found).sort()
}

/**
 * Checa se hora atual está dentro da janela permitida (HH:MM no fuso UTC-3
 * SP por padrão MVP — Sprint 13+ adiciona timezone por tenant).
 */
export function isWithinHourWindow(
  now: Date,
  window: { from: string; to: string },
): boolean {
  const offsetMinutes = -3 * 60 // GMT-3 SP
  const local = new Date(now.getTime() + offsetMinutes * 60_000)
  const h = local.getUTCHours()
  const m = local.getUTCMinutes()
  const curMinutes = h * 60 + m
  const [fromH, fromM] = window.from.split(':').map(Number) as [number, number]
  const [toH, toM] = window.to.split(':').map(Number) as [number, number]
  const fromMinutes = fromH * 60 + fromM
  const toMinutes = toH * 60 + toM
  if (fromMinutes <= toMinutes) {
    return curMinutes >= fromMinutes && curMinutes <= toMinutes
  }
  // Janela cruza meia-noite
  return curMinutes >= fromMinutes || curMinutes <= toMinutes
}
