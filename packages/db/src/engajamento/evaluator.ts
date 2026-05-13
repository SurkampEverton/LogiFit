/**
 * Engajamento — DSL avaliador de regras de conquista (Sprint 09 Faixa B, ADR 0021).
 *
 * Recebe `(rule: AchievementRule, ctx: MemberContext)` e retorna
 * `{matched: bool, progress: {current, target, percent}}`.
 *
 * 5 kinds canônicos MVP:
 *   - `checkin_count` — N check-ins em janela X dias (Sprint 08 fonte)
 *   - `payment_streak` — N meses consecutivos com payment.confirmed
 *   - `goal_reached` — pelo menos 1 goal kind=X reached
 *   - `tenure_days` — member tem cadastro há N dias
 *   - `referral_count` — N indicações convertidas (Sprint 05)
 *
 * **Idempotência**: `member_achievements` PK composta `(member_id,
 * achievement_id)` impede grant duplicado. Avaliador retorna sempre
 * `matched + progress`; caller decide INSERT condicional.
 *
 * Sprint 11+: evaluator pode consumir workout logs (PR strength), antropometria
 * (body composition goals) etc. Sprint 13+: integra com WhatsApp pra
 * notificar member ao desbloquear.
 */
import { z } from 'zod'

// ─── Zod schemas dos rule kinds ──────────────────────────────────────────

export const AchievementRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('checkin_count'),
    params: z.object({
      target: z.number().int().min(1).max(10000),
      within_days: z.number().int().min(1).max(3650).nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal('payment_streak'),
    params: z.object({
      months: z.number().int().min(1).max(120),
    }),
  }),
  z.object({
    kind: z.literal('goal_reached'),
    params: z.object({
      goal_kind: z
        .enum(['weight_loss', 'weight_gain', 'frequency', 'strength_pr', 'body_composition', 'custom'])
        .optional(),
      count: z.number().int().min(1).default(1),
    }),
  }),
  z.object({
    kind: z.literal('tenure_days'),
    params: z.object({
      target: z.number().int().min(1).max(36500),
    }),
  }),
  z.object({
    kind: z.literal('referral_count'),
    params: z.object({
      target: z.number().int().min(1).max(1000),
    }),
  }),
])

export type AchievementRule = z.infer<typeof AchievementRuleSchema>

// ─── Context que o evaluator consome ─────────────────────────────────────
/**
 * Caller (dispatcher Sprint 09+) consulta dados do member uma vez e passa
 * pra evaluator — o avaliador é puro (sem hit em DB).
 */
export interface MemberContext {
  memberId: string
  /** Contagem de check-ins por janela. Map<within_days_or_'all', count>. */
  checkinCounts: Map<number | 'all', number>
  /** Streak de payments confirmados consecutivos (em meses). */
  paymentStreakMonths: number
  /** Goals reached por kind. Map<goal_kind, count>; 'all' = total. */
  goalsReachedByKind: Map<string, number>
  /** Dias desde member.createdAt. */
  tenureDays: number
  /** Quantos referrals do member converteram (referral_uses). */
  referralConvertedCount: number
}

export interface EvaluationResult {
  matched: boolean
  progress: {
    current: number
    target: number
    percent: number
  }
}

// ─── evaluateRule ────────────────────────────────────────────────────────
/**
 * Avalia rule contra context. Retorna {matched, progress}.
 *
 * Throws se rule é inválido (não deveria acontecer — validar via Zod no
 * INSERT em achievements.rule).
 */
export function evaluateRule(
  rule: AchievementRule,
  ctx: MemberContext,
): EvaluationResult {
  switch (rule.kind) {
    case 'checkin_count': {
      const target = rule.params.target
      const window = rule.params.within_days ?? 'all'
      const current = ctx.checkinCounts.get(window as number | 'all') ?? 0
      return {
        matched: current >= target,
        progress: progressOf(current, target),
      }
    }
    case 'payment_streak': {
      const target = rule.params.months
      const current = ctx.paymentStreakMonths
      return {
        matched: current >= target,
        progress: progressOf(current, target),
      }
    }
    case 'goal_reached': {
      const target = rule.params.count ?? 1
      const kind = rule.params.goal_kind ?? 'all'
      const current = ctx.goalsReachedByKind.get(kind) ?? 0
      return {
        matched: current >= target,
        progress: progressOf(current, target),
      }
    }
    case 'tenure_days': {
      const target = rule.params.target
      const current = ctx.tenureDays
      return {
        matched: current >= target,
        progress: progressOf(current, target),
      }
    }
    case 'referral_count': {
      const target = rule.params.target
      const current = ctx.referralConvertedCount
      return {
        matched: current >= target,
        progress: progressOf(current, target),
      }
    }
  }
}

function progressOf(current: number, target: number): { current: number; target: number; percent: number } {
  const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  return { current, target, percent }
}

/**
 * Helper: parseia `unknown` (vindo do banco jsonb) pra AchievementRule
 * validado. Retorna null se inválido (caller log error + skip).
 */
export function parseRuleJsonb(raw: unknown): AchievementRule | null {
  const result = AchievementRuleSchema.safeParse(raw)
  return result.success ? result.data : null
}
