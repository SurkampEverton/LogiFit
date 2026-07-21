/**
 * Workflow de aprovação AP — Sprint 15 Faixa B (ADR 0034).
 *
 * Funções puras que decidem o próximo estado de uma AP baseado em:
 *   - approval_rules vigentes do tenant
 *   - valor da AP
 *   - approval_trace (histórico)
 *   - role do usuário tentando aprovar
 *
 * **Estratégia de matching de rule**: dentre rules ativas com `scope ∈ {ap, both}`
 * e `min ≤ amount ≤ max` (max NULL = sem teto), pega a de menor `max_amount_cents`.
 * Ex: rule "até R$500 auto-aprovado", rule "R$500-R$5000 gerente", rule "R$5000+ gerente+diretor".
 *
 * **Aprovadores em série** (mode='series'): cada aprovador na ordem do array
 * deve aprovar antes do próximo. Estado avança quando o último aprovou.
 *
 * **Aprovadores em paralelo** (mode='parallel'): todos os aprovadores precisam
 * aprovar mas em qualquer ordem.
 *
 * **Auto-aproved**: se `required_approvers.approvers` é vazio → submit aprova
 * direto (AP até R$500 por exemplo).
 *
 * Sprint 15+ adiciona: aprovador escalada por timeout, reprovação revoga
 * aprovações parciais.
 */

import { z } from 'zod'

// ─── DSL Zod (validação JSONB) ──────────────────────────────────────────

export const ApproverSchema = z
  .object({
    role: z.string().min(1).max(80).optional(),
    userId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.userId !== undefined,
    'Cada approver requer role OU user_id',
  )

export const RequiredApproversSchema = z.object({
  mode: z.enum(['series', 'parallel']).default('series'),
  approvers: z.array(ApproverSchema).max(10),
})

export const ApprovalTraceEntrySchema = z.object({
  at: z.string(), // ISO datetime
  byUserId: z.string().uuid(),
  byRole: z.string().optional(),
  action: z.enum(['submitted', 'approved', 'rejected', 'comment']),
  comment: z.string().max(2000).optional(),
})

export type Approver = z.infer<typeof ApproverSchema>
export type RequiredApprovers = z.infer<typeof RequiredApproversSchema>
export type ApprovalTraceEntry = z.infer<typeof ApprovalTraceEntrySchema>

// ─── Rules matching ──────────────────────────────────────────────────────

export interface ApprovalRuleRow {
  id: string
  minAmountCents: number
  maxAmountCents: number | null
  requiredApprovers: RequiredApprovers
  companyId: string | null
  active: boolean
}

/**
 * Retorna a rule que melhor cobre o `amountCents` da AP — menor `max_amount_cents`
 * dentre as ativas que englobam o valor. Retorna null se nenhuma rule matches
 * (AP sem aprovação requerida).
 *
 * Se `companyId` informado, prioriza rules com company_id matching; cai pra
 * rules sem company_id (globais ao tenant) caso não exista específica.
 */
export function pickApprovalRule(
  amountCents: number,
  companyId: string | null,
  rules: ApprovalRuleRow[],
): ApprovalRuleRow | null {
  const candidates = rules.filter(
    (r) =>
      r.active &&
      amountCents >= r.minAmountCents &&
      (r.maxAmountCents === null || amountCents <= r.maxAmountCents),
  )
  if (candidates.length === 0) return null

  // Prioriza rule de company_id específica
  const companyRules = companyId ? candidates.filter((r) => r.companyId === companyId) : []
  const globalRules = candidates.filter((r) => r.companyId === null)

  const pool = companyRules.length > 0 ? companyRules : globalRules
  if (pool.length === 0) return null

  // Menor max_amount_cents (mais específica) primeiro; NULL é "infinito"
  return pool.sort((a, b) => {
    if (a.maxAmountCents === null) return 1
    if (b.maxAmountCents === null) return -1
    return a.maxAmountCents - b.maxAmountCents
  })[0]!
}

// ─── Decision engine ─────────────────────────────────────────────────────

export type ApprovalDecision =
  | { state: 'approved'; reason: 'no_rule_required' }
  | { state: 'approved'; reason: 'auto_approved'; ruleId: string }
  | { state: 'approved'; reason: 'all_approvers_done'; ruleId: string }
  | { state: 'pending_approval'; nextApprover: Approver; ruleId: string }
  | { state: 'pending_approval'; remainingApprovers: Approver[]; ruleId: string }
  | { state: 'rejected'; reason: string }

/**
 * Recebe AP context (amount + company + trace atual) + rules + ação do usuário.
 * Retorna decisão de próximo estado.
 *
 * Casos:
 *   1. Sem rule matching → auto-aprovada (no_rule_required)
 *   2. Rule com approvers vazio → auto-aprovada
 *   3. mode='series' → encontra próximo approver na ordem que ainda não aprovou
 *   4. mode='parallel' → verifica se todos aprovaram
 *   5. trace contém 'rejected' → state='rejected'
 */
export function decideNextState(input: {
  amountCents: number
  companyId: string | null
  rules: ApprovalRuleRow[]
  trace: ApprovalTraceEntry[]
}): ApprovalDecision {
  // Caso terminal: trace contém rejeição
  const rejection = input.trace.find((t) => t.action === 'rejected')
  if (rejection) {
    return {
      state: 'rejected',
      reason: rejection.comment ?? 'Rejeitada',
    }
  }

  const rule = pickApprovalRule(input.amountCents, input.companyId, input.rules)
  if (!rule) {
    return { state: 'approved', reason: 'no_rule_required' }
  }

  const required = rule.requiredApprovers
  if (required.approvers.length === 0) {
    return { state: 'approved', reason: 'auto_approved', ruleId: rule.id }
  }

  // Aprovações no trace
  const approvals = input.trace.filter((t) => t.action === 'approved')

  function approverDone(approver: Approver): boolean {
    return approvals.some((a) => {
      if (approver.userId && a.byUserId === approver.userId) return true
      if (approver.role && a.byRole === approver.role) return true
      return false
    })
  }

  if (required.mode === 'series') {
    // Próximo approver da fila que ainda não aprovou
    for (const approver of required.approvers) {
      if (!approverDone(approver)) {
        return { state: 'pending_approval', nextApprover: approver, ruleId: rule.id }
      }
    }
    return { state: 'approved', reason: 'all_approvers_done', ruleId: rule.id }
  }

  // mode='parallel'
  const remaining = required.approvers.filter((a) => !approverDone(a))
  if (remaining.length === 0) {
    return { state: 'approved', reason: 'all_approvers_done', ruleId: rule.id }
  }
  return {
    state: 'pending_approval',
    remainingApprovers: remaining,
    ruleId: rule.id,
  }
}

/**
 * Valida que o user/role pode executar o action sobre a AP — útil pra
 * Server Action `approveAP` rejeitar tentativas de aprovar fora de ordem.
 */
export function canUserApprove(input: {
  userId: string
  userRoles: string[]
  amountCents: number
  companyId: string | null
  rules: ApprovalRuleRow[]
  trace: ApprovalTraceEntry[]
}): { allowed: boolean; reason?: string } {
  const decision = decideNextState({
    amountCents: input.amountCents,
    companyId: input.companyId,
    rules: input.rules,
    trace: input.trace,
  })

  if (decision.state !== 'pending_approval') {
    return { allowed: false, reason: `AP em estado ${decision.state}, não comporta aprovação` }
  }

  function matchesUser(approver: Approver): boolean {
    if (approver.userId && approver.userId === input.userId) return true
    if (approver.role && input.userRoles.includes(approver.role)) return true
    return false
  }

  if ('nextApprover' in decision) {
    return matchesUser(decision.nextApprover)
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'Você não é o próximo aprovador na série',
        }
  }
  if ('remainingApprovers' in decision) {
    return decision.remainingApprovers.some(matchesUser)
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'Você não está na lista de aprovadores paralelos pendentes',
        }
  }
  return { allowed: false, reason: 'Estado de aprovação inesperado' }
}
