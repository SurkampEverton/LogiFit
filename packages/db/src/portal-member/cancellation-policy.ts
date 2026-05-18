/**
 * Cancellation Policy — Sprint 26 Faixa B.1.
 *
 * Decide se paciente pode auto-cancelar seu agendamento. Regras por vertical
 * (Academia: livre 4h antes; Fisio: aviso ao profissional, sem auto-cancel
 * D-24h; Nutri: reagendamento ao invés de cancelamento).
 *
 * **Pergunta aberta do sprint resolvida pragmaticamente:**
 *   - Academia: auto-cancel até X horas antes (configurável por tenant; default 4h)
 *   - Fisio: auto-cancel até X horas antes (configurável; default 24h); abaixo
 *     disso vira `awaiting_provider_ack` (profissional precisa confirmar)
 *   - Nutri: nunca cancela direto — sempre é "reagendar" (cria appointment_request)
 *
 * Tenant pode overridar via `tenant_settings.cancellation_policies` (Sprint 26b).
 */

export type Vertical = 'academia' | 'fisio' | 'nutri' | 'personal' | 'pilates'

export interface CancellationPolicy {
  /** Horas mínimas antes do appointment pra auto-cancel direto */
  selfCancelHoursBeforeMin: number
  /** True = pode auto-cancelar direto; false = vira awaiting_provider_ack */
  allowsDirectCancel: boolean
  /** True = paciente deve reagendar ao invés de cancelar (Nutri) */
  prefersReschedule: boolean
}

/** Defaults canônicos (Sprint 26 — tenant pode overridar) */
export const DEFAULT_POLICIES: Record<Vertical, CancellationPolicy> = {
  academia: {
    selfCancelHoursBeforeMin: 4,
    allowsDirectCancel: true,
    prefersReschedule: false,
  },
  personal: {
    selfCancelHoursBeforeMin: 12,
    allowsDirectCancel: true,
    prefersReschedule: false,
  },
  pilates: {
    selfCancelHoursBeforeMin: 12,
    allowsDirectCancel: true,
    prefersReschedule: false,
  },
  fisio: {
    selfCancelHoursBeforeMin: 24,
    allowsDirectCancel: true, // até 24h antes; depois vira awaiting_provider_ack
    prefersReschedule: false,
  },
  nutri: {
    selfCancelHoursBeforeMin: 48,
    allowsDirectCancel: false, // sempre vira "reagendar"
    prefersReschedule: true,
  },
}

export type CancellationDecision =
  | { ok: true; action: 'cancel_directly' }
  | { ok: true; action: 'awaiting_provider_ack'; reason: 'too_close_to_start' }
  | { ok: false; action: 'must_reschedule'; reason: 'vertical_prefers_reschedule' }
  | { ok: false; action: 'denied'; reason: 'already_started' | 'already_cancelled' }

export interface DecideCancelInput {
  vertical: Vertical
  appointmentStartsAt: string // ISO
  appointmentStatus: 'scheduled' | 'confirmed' | 'cancelled' | 'no_show' | 'completed'
  now?: string
  /** Override por tenant (Sprint 26b futuro). Default = DEFAULT_POLICIES[vertical]. */
  policy?: CancellationPolicy
}

/**
 * Decide se paciente pode cancelar seu agendamento.
 */
export function decideCancellation(input: DecideCancelInput): CancellationDecision {
  if (input.appointmentStatus === 'cancelled' || input.appointmentStatus === 'no_show') {
    return { ok: false, action: 'denied', reason: 'already_cancelled' }
  }
  if (input.appointmentStatus === 'completed') {
    return { ok: false, action: 'denied', reason: 'already_cancelled' }
  }
  const now = new Date(input.now ?? new Date().toISOString())
  const start = new Date(input.appointmentStartsAt)
  if (now.getTime() >= start.getTime()) {
    return { ok: false, action: 'denied', reason: 'already_started' }
  }
  const policy = input.policy ?? DEFAULT_POLICIES[input.vertical]
  if (policy.prefersReschedule) {
    return { ok: false, action: 'must_reschedule', reason: 'vertical_prefers_reschedule' }
  }
  const hoursUntil = (start.getTime() - now.getTime()) / (60 * 60 * 1000)
  if (hoursUntil >= policy.selfCancelHoursBeforeMin) {
    return { ok: true, action: 'cancel_directly' }
  }
  if (policy.allowsDirectCancel) {
    return { ok: true, action: 'awaiting_provider_ack', reason: 'too_close_to_start' }
  }
  return { ok: false, action: 'must_reschedule', reason: 'vertical_prefers_reschedule' }
}
