/**
 * Calculadora de comissão — Sprint 23 Faixa B.1 (ADR 0086 esperado).
 *
 * Pure function: recebe evento gerador + contrato + rules + retorna entry.
 * Caller (Server Action) persiste em `commission_entries`.
 *
 * **4 kinds × 4 bases:**
 *   - percent_faturamento × {faturado/recebido_particular/recebido_convenio/misto}
 *   - percent_recebido    × {recebido_particular/recebido_convenio/misto}
 *   - fixo_por_atendimento × any (ignora valor de referência; usa default_amount_cents)
 *   - tabela_por_servico × any (consulta commission_rules pra resolver percent/amount)
 *
 * **Resolução de override:**
 *   1. Rule com tussCode matching (mais específico) — priority asc
 *   2. Rule com serviceType matching — priority asc
 *   3. Fallback default_percent / default_amount_cents do contrato
 *
 * **Compatibilidade kind × base:**
 *   - `percent_recebido` SÓ aceita base `recebido_*` ou `misto`
 *   - `percent_faturamento` SÓ aceita base `faturado` ou `misto`
 *   - Mismatch lança erro acionável
 *
 * **Retenções (ADR 0061):** placeholder MVP retornando retentionCents=0.
 * Sprint 23b integra `calculateRetentions()` real consumindo `tax_natures`.
 */

export type CommissionKind =
  | 'percent_faturamento'
  | 'percent_recebido'
  | 'fixo_por_atendimento'
  | 'tabela_por_servico'

export type CommissionBase =
  | 'faturado'
  | 'recebido_particular'
  | 'recebido_convenio'
  | 'misto'

export type EventKind = 'invoice_issued' | 'payment_received' | 'guide_paid' | 'appointment_completed' | 'consulta_signed' | 'evolucao_created'

export interface CommissionEvent {
  /** Tipo do evento que disparou — define qual base aplica */
  kind: EventKind
  /** Valor em centavos (faturado para invoice_issued; recebido para payment/guide; 0 para appointment) */
  amountCents: number
  /** Identificador único do evento — vira `source_event_ref` */
  ref: string
  /** Tipo do serviço (resolve rule override) */
  serviceType: string | null
  /** TUSS code (resolve rule override mais específico) */
  tussCode: string | null
  /** Quando o evento aconteceu — vira `earned_at` */
  occurredAt: string // ISO
  /** Origem do recebimento — define se conta para base recebido_particular ou recebido_convenio */
  paymentSource?: 'particular' | 'convenio' | null
}

export interface CommissionContract {
  id: string
  personId: string
  userId: string | null
  companyId: string
  serviceType: string
  kind: CommissionKind
  base: CommissionBase
  defaultPercent: number | null
  defaultAmountCents: number | null
  active: boolean
  effectiveFrom: string // YYYY-MM-DD
  effectiveTo: string | null
}

export interface CommissionRuleRow {
  id: string
  contractId: string
  serviceType: string | null
  tussCode: string | null
  percent: number | null
  amountCents: number | null
  priority: number
  active: boolean
}

export interface CommissionEntryDraft {
  contractId: string
  personId: string
  userId: string | null
  companyId: string
  sourceEventRef: string
  referenceAmountCents: number
  commissionCents: number
  percentApplied: number | null
  serviceType: string | null
  tussCode: string | null
  taxNatureId: string | null
  retentionTotalCents: number
  netAmountCents: number
  earnedAt: string
}

export interface CalculateResult {
  /** Quando null = evento não gera comissão (kind+base incompatível, ou amount=0) */
  entry: CommissionEntryDraft | null
  /** Motivo quando entry=null */
  skipReason?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Verifica se kind+base é coerente com o tipo do evento.
 *
 * Tabela de compatibilidade:
 *   invoice_issued → base 'faturado' ou 'misto'
 *   payment_received (particular) → base 'recebido_particular' ou 'misto'
 *   payment_received (convenio) → base 'recebido_convenio' ou 'misto'
 *   guide_paid → base 'recebido_convenio' ou 'misto'
 *   appointment_completed / consulta_signed / evolucao_created → SÓ kind=fixo_por_atendimento
 */
function isEventCompatibleWithContract(
  event: CommissionEvent,
  contract: CommissionContract,
): { ok: true } | { ok: false; reason: string } {
  // Fixo por atendimento: só aceita eventos "atendimento"
  if (contract.kind === 'fixo_por_atendimento') {
    if (
      event.kind === 'appointment_completed' ||
      event.kind === 'consulta_signed' ||
      event.kind === 'evolucao_created'
    ) {
      return { ok: true }
    }
    return {
      ok: false,
      reason: `kind=fixo_por_atendimento aceita appointment/consulta/evolucao, não ${event.kind}`,
    }
  }

  // Tabela por serviço: aceita qualquer evento (rule define valor)
  if (contract.kind === 'tabela_por_servico') return { ok: true }

  // percent_faturamento: invoice_issued (base faturado/misto)
  if (contract.kind === 'percent_faturamento') {
    if (event.kind !== 'invoice_issued') {
      return {
        ok: false,
        reason: `kind=percent_faturamento aceita invoice_issued, não ${event.kind}`,
      }
    }
    if (contract.base !== 'faturado' && contract.base !== 'misto') {
      return {
        ok: false,
        reason: `kind=percent_faturamento com base=${contract.base}: aceita 'faturado' ou 'misto'`,
      }
    }
    return { ok: true }
  }

  // percent_recebido: payment_received | guide_paid (base recebido_*)
  if (contract.kind === 'percent_recebido') {
    if (event.kind !== 'payment_received' && event.kind !== 'guide_paid') {
      return {
        ok: false,
        reason: `kind=percent_recebido aceita payment_received/guide_paid, não ${event.kind}`,
      }
    }
    if (contract.base === 'recebido_particular' && event.paymentSource !== 'particular') {
      return {
        ok: false,
        reason: 'base=recebido_particular exige paymentSource=particular',
      }
    }
    if (contract.base === 'recebido_convenio') {
      if (event.kind !== 'guide_paid' && event.paymentSource !== 'convenio') {
        return {
          ok: false,
          reason: 'base=recebido_convenio exige guide_paid ou paymentSource=convenio',
        }
      }
    }
    return { ok: true }
  }

  return { ok: false, reason: 'kind desconhecido' }
}

/**
 * Resolve rule mais específica para o evento.
 *
 * Ordem:
 *   1. tussCode + serviceType match (mais específico)
 *   2. tussCode match
 *   3. serviceType match
 *   4. null (fallback default)
 */
export function resolveRule(
  event: { serviceType: string | null; tussCode: string | null },
  rules: CommissionRuleRow[],
): CommissionRuleRow | null {
  const active = rules.filter((r) => r.active).slice().sort((a, b) => a.priority - b.priority)

  // 1. Match tussCode + serviceType
  if (event.tussCode && event.serviceType) {
    const exact = active.find(
      (r) => r.tussCode === event.tussCode && r.serviceType === event.serviceType,
    )
    if (exact) return exact
  }

  // 2. Match só tussCode
  if (event.tussCode) {
    const byTuss = active.find((r) => r.tussCode === event.tussCode)
    if (byTuss) return byTuss
  }

  // 3. Match só serviceType
  if (event.serviceType) {
    const byService = active.find(
      (r) => r.serviceType === event.serviceType && r.tussCode === null,
    )
    if (byService) return byService
  }

  return null
}

/**
 * Cálculo principal. Retorna entry pronta pra persistência ou skipReason.
 */
export function calculateCommission(input: {
  event: CommissionEvent
  contract: CommissionContract
  rules: CommissionRuleRow[]
  /** Hoje, pra checar contrato vigente (default new Date()) */
  today?: string
}): CalculateResult {
  const today = input.today ?? new Date().toISOString().slice(0, 10)

  // 1. Contrato vigente?
  if (!input.contract.active) {
    return { entry: null, skipReason: 'Contrato inativo' }
  }
  if (input.contract.effectiveFrom > today) {
    return { entry: null, skipReason: 'Contrato ainda não vigente' }
  }
  if (input.contract.effectiveTo && input.contract.effectiveTo < today) {
    return { entry: null, skipReason: 'Contrato vencido' }
  }

  // 2. Evento compatível?
  const compat = isEventCompatibleWithContract(input.event, input.contract)
  if (!compat.ok) {
    return { entry: null, skipReason: compat.reason }
  }

  // 3. Valor zero → skip
  if (input.event.amountCents === 0 && input.contract.kind !== 'fixo_por_atendimento') {
    return { entry: null, skipReason: 'Valor zero' }
  }

  // 4. Resolve rule + calcula
  const rule = resolveRule(
    { serviceType: input.event.serviceType, tussCode: input.event.tussCode },
    input.rules,
  )

  let commissionCents = 0
  let percentApplied: number | null = null

  if (input.contract.kind === 'fixo_por_atendimento') {
    // Rule pode overridar amount; senão usa default
    const amount = rule?.amountCents ?? input.contract.defaultAmountCents ?? 0
    commissionCents = amount
  } else if (input.contract.kind === 'tabela_por_servico') {
    if (!rule) {
      return {
        entry: null,
        skipReason: `tabela_por_servico exige rule pra serviceType=${input.event.serviceType ?? 'null'} / tussCode=${input.event.tussCode ?? 'null'}`,
      }
    }
    if (rule.amountCents != null) {
      commissionCents = rule.amountCents
    } else if (rule.percent != null) {
      commissionCents = Math.round((input.event.amountCents * Number(rule.percent)) / 100)
      percentApplied = Number(rule.percent)
    }
  } else {
    // percent_faturamento / percent_recebido
    const pct = rule?.percent != null ? Number(rule.percent) : input.contract.defaultPercent
    if (pct == null) {
      return { entry: null, skipReason: 'Sem percent definido' }
    }
    commissionCents = Math.round((input.event.amountCents * Number(pct)) / 100)
    percentApplied = Number(pct)
  }

  // 5. Retenções placeholder (Sprint 23b integra calculateRetentions real)
  const retentionTotalCents = 0
  const netAmountCents = commissionCents - retentionTotalCents

  return {
    entry: {
      contractId: input.contract.id,
      personId: input.contract.personId,
      userId: input.contract.userId,
      companyId: input.contract.companyId,
      sourceEventRef: input.event.ref,
      referenceAmountCents: input.event.amountCents,
      commissionCents,
      percentApplied,
      serviceType: input.event.serviceType,
      tussCode: input.event.tussCode,
      taxNatureId: null,
      retentionTotalCents,
      netAmountCents,
      earnedAt: input.event.occurredAt,
    },
  }
}

// ─── Agregação de period ────────────────────────────────────────────────

export interface PeriodSummary {
  totalEntries: number
  grossTotalCents: number
  retentionTotalCents: number
  netTotalCents: number
  deductionsCents: number
}

export function aggregateEntries(
  entries: Array<{
    commissionCents: number
    retentionTotalCents: number
    netAmountCents: number
    status: string
  }>,
  deductionsCents = 0,
): PeriodSummary {
  // Apenas entries 'included' contam (pending vira included no closePeriod)
  const active = entries.filter((e) => e.status === 'included' || e.status === 'pending')
  const gross = active.reduce((s, e) => s + e.commissionCents, 0)
  const retention = active.reduce((s, e) => s + e.retentionTotalCents, 0)
  const net = gross - retention - deductionsCents
  return {
    totalEntries: active.length,
    grossTotalCents: gross,
    retentionTotalCents: retention,
    netTotalCents: net,
    deductionsCents,
  }
}
