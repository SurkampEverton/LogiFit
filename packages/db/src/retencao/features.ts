/**
 * Pipeline de features de churn — Sprint 19 Faixa B.1 (ADR 0027 Fase 1).
 *
 * `computeFeatures(input)` é função **pura** — não toca DB. Server Action
 * carrega rows brutas (check-ins, invoices, contract, achievements) e passa
 * pra cá; testes Vitest cobrem cenários canônicos sem precisar de DB.
 *
 * **Snapshot hash** (sha256 hex) computado pra cache key — predição reusa
 * resultado quando features inalteradas.
 */
import { createHash } from 'node:crypto'

export interface ChurnFeaturesInput {
  /** Hoje no contexto do cálculo (default new Date()). */
  asOf?: Date
  /** ISO datetimes de check-ins do member (últimos 90 dias). */
  checkInDates: string[]
  /** Invoices com status + amounts. */
  invoices: Array<{
    /** Aceita ambas convenções: enum atual (pending/cancelled/refunded) ou histórica (issued/draft/canceled). Apenas paid/overdue são consumidos hoje. */
    status: 'paid' | 'overdue' | 'pending' | 'cancelled' | 'refunded' | 'issued' | 'draft' | 'canceled'
    amountCents: number
    dueDate: string // YYYY-MM-DD
    paidAt?: string | null
  }>
  /** Contract start date (ISO datetime) e plano atual. */
  contractStartedAt: string
  /** True se plano atual é downgrade vs anterior. */
  planChangedDowngrade?: boolean
  /** ISO datetime da última mudança de plano. */
  lastPlanChangeAt?: string | null
  /** Conquistas dos últimos 90d. */
  achievementsEarned90d?: number
  /** Metas ativas. */
  goalsActiveCount?: number
}

export interface ChurnFeatures {
  /** Visitas nos últimos 30 dias */
  frequencyLast30d: number
  /** Visitas nos 30 dias anteriores (dias 31-60) */
  frequencyPrev30d: number
  /** Variação % entre os 2 períodos (negativo = caiu) */
  frequencyChangePct: number
  /** Dias desde o último check-in (-1 se nunca) */
  daysSinceLastCheckin: number
  /** Total de invoices overdue */
  overdueInvoicesCount: number
  /** Soma dos valores overdue */
  overdueTotalCents: number
  /** Há quantos meses é member */
  monthsAsMember: number
  /** Ticket médio (paid últimos 6 meses) */
  avgTicketCents: number
  /** Achievements ganhos nos últimos 90d */
  achievementsEarned90d: number
  /** Metas ativas */
  goalsActiveCount: number
  /** Última mudança de plano (YYYY-MM-DD ou null) */
  lastPlanChangeAt: string | null
  /** True se downgrade recente */
  planChangedDowngrade: boolean
}

/**
 * Calcula todas as features estruturadas. Determinístico.
 */
export function computeFeatures(input: ChurnFeaturesInput): ChurnFeatures {
  const asOf = input.asOf ?? new Date()
  const asOfMs = asOf.getTime()

  // ─── Frequência 30d e 30-60d ──────────────────────────────────────────
  let last30 = 0
  let prev30 = 0
  let mostRecentMs = -Infinity
  for (const c of input.checkInDates) {
    const ms = new Date(c).getTime()
    if (Number.isNaN(ms)) continue
    const daysAgo = (asOfMs - ms) / (24 * 60 * 60 * 1000)
    if (daysAgo < 0) continue
    if (daysAgo <= 30) last30 += 1
    else if (daysAgo <= 60) prev30 += 1
    if (ms > mostRecentMs) mostRecentMs = ms
  }
  const daysSinceLastCheckin =
    mostRecentMs === -Infinity
      ? -1
      : Math.floor((asOfMs - mostRecentMs) / (24 * 60 * 60 * 1000))
  const frequencyChangePct =
    prev30 === 0 ? (last30 === 0 ? 0 : 100) : Number((((last30 - prev30) / prev30) * 100).toFixed(1))

  // ─── Invoices overdue ────────────────────────────────────────────────
  let overdueCount = 0
  let overdueCents = 0
  let paidLast6mSum = 0
  let paidLast6mCount = 0
  const sixMonthsAgo = asOfMs - 180 * 24 * 60 * 60 * 1000
  for (const inv of input.invoices) {
    if (inv.status === 'overdue') {
      overdueCount += 1
      overdueCents += inv.amountCents
    }
    if (inv.status === 'paid' && inv.paidAt) {
      const paidMs = new Date(inv.paidAt).getTime()
      if (paidMs >= sixMonthsAgo) {
        paidLast6mSum += inv.amountCents
        paidLast6mCount += 1
      }
    }
  }
  const avgTicketCents = paidLast6mCount === 0 ? 0 : Math.round(paidLast6mSum / paidLast6mCount)

  // ─── Tempo como member ────────────────────────────────────────────────
  const contractStartMs = new Date(input.contractStartedAt).getTime()
  const monthsAsMember = Math.max(
    0,
    Math.floor((asOfMs - contractStartMs) / (30 * 24 * 60 * 60 * 1000)),
  )

  return {
    frequencyLast30d: last30,
    frequencyPrev30d: prev30,
    frequencyChangePct,
    daysSinceLastCheckin,
    overdueInvoicesCount: overdueCount,
    overdueTotalCents: overdueCents,
    monthsAsMember,
    avgTicketCents,
    achievementsEarned90d: input.achievementsEarned90d ?? 0,
    goalsActiveCount: input.goalsActiveCount ?? 0,
    lastPlanChangeAt: input.lastPlanChangeAt ?? null,
    planChangedDowngrade: input.planChangedDowngrade ?? false,
  }
}

/**
 * Hash SHA-256 hex do features JSON canônico — cache key.
 * Chaves ordenadas para garantir mesma representação stringificada.
 */
export function hashFeatures(features: ChurnFeatures): string {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(features).sort()) {
    ordered[key] = features[key as keyof ChurnFeatures]
  }
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}
