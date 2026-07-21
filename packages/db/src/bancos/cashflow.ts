/**
 * Projeção de fluxo de caixa — Sprint 17 Faixa B.
 *
 * Combina:
 *   - Saldo atual dos bank_accounts (sum currentBalanceCents)
 *   - APs futuras (pending_approval / approved / scheduled) agrupadas por dueDate
 *   - ARs futuras (draft / issued) agrupadas por dueDate
 *
 * Output: array de pontos `{date, openingBalance, inflowCents, outflowCents, closingBalance}`
 * para os próximos N dias.
 *
 * Pure function — não toca DB; Server Action passa rows já carregadas.
 */

export interface CashflowInputs {
  currentBalanceCents: number
  /** APs a pagar nos próximos N dias */
  futureAps: Array<{ dueDate: string; amountCents: number }>
  /** ARs a receber nos próximos N dias */
  futureArs: Array<{ dueDate: string; amountCents: number }>
  /** Dias à frente — default 30 */
  daysAhead: number
  /** Data início — default hoje */
  startDate?: string
}

export interface CashflowPoint {
  date: string // YYYY-MM-DD
  openingBalance: number
  inflowCents: number
  outflowCents: number
  closingBalance: number
  /** Quantas APs/ARs caem nesse dia */
  apCount: number
  arCount: number
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return isoDateOnly(d)
}

export function forecastCashflow(input: CashflowInputs): CashflowPoint[] {
  const days = Math.max(1, Math.min(input.daysAhead, 180))
  const start = input.startDate ?? isoDateOnly(new Date())

  // Agrupa APs/ARs por dueDate
  const apsByDate = new Map<string, { sum: number; count: number }>()
  for (const ap of input.futureAps) {
    const e = apsByDate.get(ap.dueDate) ?? { sum: 0, count: 0 }
    e.sum += ap.amountCents
    e.count += 1
    apsByDate.set(ap.dueDate, e)
  }
  const arsByDate = new Map<string, { sum: number; count: number }>()
  for (const ar of input.futureArs) {
    const e = arsByDate.get(ar.dueDate) ?? { sum: 0, count: 0 }
    e.sum += ar.amountCents
    e.count += 1
    arsByDate.set(ar.dueDate, e)
  }

  // Acumula APs/ARs com data anterior a start no primeiro dia (atrasadas)
  const overdueAps = Array.from(apsByDate.entries())
    .filter(([d]) => d < start)
    .reduce((s, [, v]) => ({ sum: s.sum + v.sum, count: s.count + v.count }), { sum: 0, count: 0 })
  const overdueArs = Array.from(arsByDate.entries())
    .filter(([d]) => d < start)
    .reduce((s, [, v]) => ({ sum: s.sum + v.sum, count: s.count + v.count }), { sum: 0, count: 0 })

  const points: CashflowPoint[] = []
  let balance = input.currentBalanceCents
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i)
    const ap = apsByDate.get(date) ?? { sum: 0, count: 0 }
    const ar = arsByDate.get(date) ?? { sum: 0, count: 0 }
    // Dia 0 absorve overdue
    const apTotal = i === 0 ? ap.sum + overdueAps.sum : ap.sum
    const arTotal = i === 0 ? ar.sum + overdueArs.sum : ar.sum
    const apCount = i === 0 ? ap.count + overdueAps.count : ap.count
    const arCount = i === 0 ? ar.count + overdueArs.count : ar.count
    const opening = balance
    const inflow = arTotal
    const outflow = apTotal
    balance = opening + inflow - outflow
    points.push({
      date,
      openingBalance: opening,
      inflowCents: inflow,
      outflowCents: outflow,
      closingBalance: balance,
      apCount,
      arCount,
    })
  }
  return points
}

// ─── Validador de chave NF-e (44 dígitos) ─────────────────────────────────
/**
 * Estrutura da chave NF-e (44 dígitos):
 *   - cUF (2) + AAMM (4) + CNPJ (14) + mod (2) + serie (3) + nNF (9) + tpEmis (1) + cNF (8) + cDV (1)
 *
 * O 44º dígito é DV mod 11 dos primeiros 43.
 */
export function validateNfeKey(
  chave: string,
): { ok: true; uf: string; aamm: string; cnpj: string } | { ok: false; reason: string } {
  const clean = chave.replace(/[^0-9]/g, '')
  if (clean.length !== 44) {
    return { ok: false, reason: `Chave deve ter 44 dígitos (atual: ${clean.length})` }
  }
  const dv = Number(clean[43])
  const expected = calcMod11(clean.slice(0, 43))
  if (dv !== expected) {
    return {
      ok: false,
      reason: `Dígito verificador inválido (esperado ${expected}, recebido ${dv})`,
    }
  }
  return {
    ok: true,
    uf: clean.slice(0, 2),
    aamm: clean.slice(2, 6),
    cnpj: clean.slice(6, 20),
  }
}

function calcMod11(s: string): number {
  let sum = 0
  let mult = 2
  for (let i = s.length - 1; i >= 0; i--) {
    sum += Number(s[i]) * mult
    mult = mult === 9 ? 2 : mult + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}
