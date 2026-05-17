/**
 * Motor de conciliação — Sprint 17 Faixa B tests.
 */
import { describe, expect, it } from 'vitest'
import {
  conditionMatches,
  matchRules,
  suggestMatches,
  type PaymentCandidate,
  type RuleRow,
  type TransactionInput,
} from './reconcile'

const TX_ALUGUEL: TransactionInput = {
  id: 'tx-1',
  amountCents: -380_000,
  description: 'ALUGUEL MAIO 2026 MATRIZ',
  postedAt: '2026-05-05T10:00:00Z',
}

const TX_RECEBE: TransactionInput = {
  id: 'tx-2',
  amountCents: 18_000,
  description: 'PIX RECEBIDO MARIA SILVA',
  postedAt: '2026-05-10T14:00:00Z',
}

describe('conditionMatches', () => {
  it('descriptionContains case-insensitive', () => {
    expect(conditionMatches(TX_ALUGUEL, { descriptionContains: 'aluguel' })).toBe(true)
    expect(conditionMatches(TX_ALUGUEL, { descriptionContains: 'energia' })).toBe(false)
  })

  it('amountMinCents/amountMaxCents usa valor absoluto', () => {
    expect(conditionMatches(TX_ALUGUEL, { amountMinCents: 300_000, amountMaxCents: 400_000 })).toBe(true)
    expect(conditionMatches(TX_ALUGUEL, { amountMinCents: 400_000 })).toBe(false)
  })

  it('amountSign negative match saída', () => {
    expect(conditionMatches(TX_ALUGUEL, { amountSign: 'negative' })).toBe(true)
    expect(conditionMatches(TX_ALUGUEL, { amountSign: 'positive' })).toBe(false)
    expect(conditionMatches(TX_RECEBE, { amountSign: 'positive' })).toBe(true)
  })

  it('postedFrom/postedTo aceita ISO date', () => {
    expect(conditionMatches(TX_ALUGUEL, { postedFrom: '2026-05-01', postedTo: '2026-05-10' })).toBe(true)
    expect(conditionMatches(TX_ALUGUEL, { postedFrom: '2026-06-01' })).toBe(false)
  })

  it('regex válido aceito; inválido retorna false', () => {
    expect(conditionMatches(TX_ALUGUEL, { descriptionRegex: 'aluguel.*matriz' })).toBe(true)
    expect(conditionMatches(TX_ALUGUEL, { descriptionRegex: '(' })).toBe(false)
  })
})

describe('matchRules — priority asc', () => {
  it('rule de priority menor prevalece sobre maior', () => {
    const rules: RuleRow[] = [
      {
        id: 'r-1',
        name: 'Genérico saída',
        priority: 100,
        condition: { amountSign: 'negative' },
        action: 'flag_for_review',
        targetSupplierId: null,
        targetChartAccountId: null,
        targetCompanyId: null,
        active: true,
      },
      {
        id: 'r-2',
        name: 'Aluguel específico',
        priority: 10,
        condition: { descriptionContains: 'aluguel' },
        action: 'auto_match_ap',
        targetSupplierId: 'sup-1',
        targetChartAccountId: null,
        targetCompanyId: null,
        active: true,
      },
    ]
    const matched = matchRules(TX_ALUGUEL, rules)
    expect(matched?.id).toBe('r-2')
  })

  it('rule inativa é ignorada', () => {
    const rules: RuleRow[] = [
      {
        id: 'r-x',
        name: 'Inactive',
        priority: 1,
        condition: { descriptionContains: 'aluguel' },
        action: 'auto_match_ap',
        targetSupplierId: null,
        targetChartAccountId: null,
        targetCompanyId: null,
        active: false,
      },
    ]
    expect(matchRules(TX_ALUGUEL, rules)).toBeNull()
  })

  it('nenhuma rule match retorna null', () => {
    expect(matchRules(TX_ALUGUEL, [])).toBeNull()
  })
})

describe('suggestMatches — heurística', () => {
  it('match exato (valor+data idênticos) tem score alto', () => {
    const candidates: PaymentCandidate[] = [
      {
        id: 'ap-1',
        kind: 'ap',
        amountCents: 380_000,
        dueDate: '2026-05-05',
        description: 'Aluguel maio matriz',
        supplierName: 'Imobiliária X',
      },
    ]
    const r = suggestMatches(TX_ALUGUEL, candidates)
    expect(r).toHaveLength(1)
    expect(r[0]!.score).toBeGreaterThan(0.9)
    expect(r[0]!.reasons).toContain('valor idêntico')
    expect(r[0]!.reasons).toContain('mesma data')
  })

  it('filtra por kind: tx negativa → AP; tx positiva → AR', () => {
    const candidates: PaymentCandidate[] = [
      { id: 'ar-1', kind: 'ar', amountCents: 380_000, dueDate: '2026-05-05', description: 'Aluguel matriz', payerName: 'X' },
      { id: 'ap-1', kind: 'ap', amountCents: 380_000, dueDate: '2026-05-05', description: 'Aluguel matriz', supplierName: 'X' },
    ]
    const r = suggestMatches(TX_ALUGUEL, candidates) // tx negativa
    expect(r).toHaveLength(1)
    expect(r[0]!.candidate.kind).toBe('ap')
  })

  it('valor próximo (não exato) ainda tem score razoável', () => {
    const candidates: PaymentCandidate[] = [
      {
        id: 'ap-near',
        kind: 'ap',
        amountCents: 379_000, // R$ 3.790 vs R$ 3.800
        dueDate: '2026-05-04',
        description: 'Aluguel',
        supplierName: null,
      },
    ]
    const r = suggestMatches(TX_ALUGUEL, candidates)
    expect(r).toHaveLength(1)
    expect(r[0]!.score).toBeGreaterThan(0.7)
  })

  it('valor muito diferente abaixo de minScore não retorna', () => {
    const candidates: PaymentCandidate[] = [
      {
        id: 'ap-far',
        kind: 'ap',
        amountCents: 100_000_000, // R$ 1M vs R$ 3.8k
        dueDate: '2026-12-31',
        description: 'XYZ',
        supplierName: null,
      },
    ]
    const r = suggestMatches(TX_ALUGUEL, candidates, { minScore: 0.5 })
    expect(r).toHaveLength(0)
  })

  it('top-3 retornado em ordem de score desc', () => {
    const candidates: PaymentCandidate[] = [
      { id: 'a', kind: 'ap', amountCents: 380_000, dueDate: '2026-05-05', description: 'Aluguel matriz' },
      { id: 'b', kind: 'ap', amountCents: 380_000, dueDate: '2026-05-12', description: 'Aluguel outro' },
      { id: 'c', kind: 'ap', amountCents: 379_500, dueDate: '2026-05-05', description: 'Algo' },
      { id: 'd', kind: 'ap', amountCents: 200_000, dueDate: '2026-05-05', description: 'Outra' },
    ]
    const r = suggestMatches(TX_ALUGUEL, candidates, { maxResults: 3 })
    expect(r).toHaveLength(3)
    expect(r[0]!.candidate.id).toBe('a') // exato
  })
})
