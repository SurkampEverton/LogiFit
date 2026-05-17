/**
 * reconcile.ts tests — Sprint 18 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  detectDivergences,
  matchAcquirerRules,
  ruleConditionMatches,
  suggestSettlementMatches,
  type AcquirerRuleRow,
  type BankTxInput,
  type SaleInput,
} from './reconcile'

const STONE_BANK_AC_ID = '11111111-1111-1111-1111-111111111111'

const sampleSale: SaleInput = {
  id: 'sale-1',
  provider: 'stone',
  cardBrand: 'visa',
  cardKind: 'credit',
  netAmountCents: 9700,
  expectedSettlementDate: '2026-06-01',
  capturedAt: '2026-05-02T10:00:00Z',
}

describe('matchAcquirerRules', () => {
  it('rule providerEquals=stone match sale.provider=stone', () => {
    const rule: AcquirerRuleRow = {
      id: 'r1',
      name: 'Stone any',
      priority: 100,
      condition: { providerEquals: 'stone' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [rule])).toBe(rule)
  })

  it('rule providerEquals=cielo NÃO match sale.provider=stone', () => {
    const rule: AcquirerRuleRow = {
      id: 'r1',
      name: 'Cielo any',
      priority: 100,
      condition: { providerEquals: 'cielo' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [rule])).toBeNull()
  })

  it('priority asc — primeira que casa prevalece', () => {
    const r10: AcquirerRuleRow = {
      id: 'r10',
      name: 'Generic',
      priority: 100,
      condition: { providerEquals: 'stone' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    const r1: AcquirerRuleRow = {
      id: 'r1',
      name: 'Specific',
      priority: 10,
      condition: { providerEquals: 'stone', cardKindEquals: 'credit' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [r10, r1])?.id).toBe('r1')
  })

  it('rule inativa ignorada', () => {
    const rule: AcquirerRuleRow = {
      id: 'r1',
      name: 'Inactive',
      priority: 100,
      condition: { providerEquals: 'stone' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: false,
    }
    expect(matchAcquirerRules(sampleSale, [rule])).toBeNull()
  })

  it('amountMin/Max filtram corretamente', () => {
    const ruleSmall: AcquirerRuleRow = {
      id: 'r1',
      name: 'big sales',
      priority: 100,
      condition: { amountMinCents: 100_000 },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [ruleSmall])).toBeNull()

    const ruleBig: AcquirerRuleRow = {
      id: 'r2',
      name: 'small sales',
      priority: 100,
      condition: { amountMaxCents: 100_000 },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [ruleBig])).toBe(ruleBig)
  })

  it('cardBrandEquals case-insensitive', () => {
    const rule: AcquirerRuleRow = {
      id: 'r1',
      name: 'visa-only',
      priority: 100,
      condition: { cardBrandEquals: 'VISA' },
      action: 'auto_match_bank',
      targetBankAccountId: null,
      active: true,
    }
    expect(ruleConditionMatches(sampleSale, rule)).toBe(true)
  })

  it('com bankTx valida targetBankAccountId + descrição + daysAfterSettlementMax', () => {
    const bankTx: BankTxInput = {
      id: 'bt-1',
      amountCents: 9700,
      postedAt: '2026-06-02T08:00:00Z',
      description: 'STONE LIQUIDACAO',
      bankAccountId: STONE_BANK_AC_ID,
    }
    const rule: AcquirerRuleRow = {
      id: 'r1',
      name: 'Stone in Itaú',
      priority: 100,
      condition: {
        providerEquals: 'stone',
        bankDescriptionContains: 'liquidacao',
        daysAfterSettlementMax: 3,
      },
      action: 'auto_match_bank',
      targetBankAccountId: STONE_BANK_AC_ID,
      active: true,
    }
    expect(matchAcquirerRules(sampleSale, [rule], bankTx)).toBe(rule)
  })
})

describe('suggestSettlementMatches', () => {
  it('settlement exato no D+settlement = score próximo de 1.0', () => {
    const bankTx: BankTxInput = {
      id: 'bt-exact',
      amountCents: sampleSale.netAmountCents,
      postedAt: `${sampleSale.expectedSettlementDate}T08:00:00Z`,
      description: 'STONE LIQUIDACAO 02JUN',
      bankAccountId: STONE_BANK_AC_ID,
    }
    const r = suggestSettlementMatches(sampleSale, [bankTx])
    expect(r).toHaveLength(1)
    expect(r[0]!.score).toBeGreaterThan(0.9)
    expect(r[0]!.reasons).toContain('valor exato')
    expect(r[0]!.reasons).toContain('mesma data')
  })

  it('settlement D+2 ainda casa com score reduzido', () => {
    const bankTx: BankTxInput = {
      id: 'bt-d2',
      amountCents: sampleSale.netAmountCents,
      postedAt: '2026-06-03T08:00:00Z',
      description: 'STONE LIQUIDACAO',
      bankAccountId: STONE_BANK_AC_ID,
    }
    const r = suggestSettlementMatches(sampleSale, [bankTx])
    expect(r).toHaveLength(1)
    expect(r[0]!.score).toBeGreaterThan(0.5)
    expect(r[0]!.reasons.some((x) => x.includes('D+2'))).toBe(true)
  })

  it('crédito antes do settlement esperado dateScore=0 (improvável)', () => {
    const bankTx: BankTxInput = {
      id: 'bt-early',
      amountCents: sampleSale.netAmountCents,
      postedAt: '2026-05-25T08:00:00Z',
      description: 'STONE LIQUIDACAO',
      bankAccountId: STONE_BANK_AC_ID,
    }
    const r = suggestSettlementMatches(sampleSale, [bankTx])
    if (r.length > 0) {
      expect(r[0]!.score).toBeLessThan(0.7)
    }
  })

  it('débitos (negativos) descartados — só crédito = settlement', () => {
    const debit: BankTxInput = {
      id: 'bt-debit',
      amountCents: -9700,
      postedAt: '2026-06-01T08:00:00Z',
      description: 'PAGAMENTO ALUGUEL',
      bankAccountId: STONE_BANK_AC_ID,
    }
    const r = suggestSettlementMatches(sampleSale, [debit])
    expect(r).toHaveLength(0)
  })

  it('top-3 ordenado por score desc', () => {
    const txs: BankTxInput[] = [
      {
        id: 'bt-mid',
        amountCents: 9500,
        postedAt: '2026-06-02T08:00:00Z',
        description: 'STONE',
        bankAccountId: STONE_BANK_AC_ID,
      },
      {
        id: 'bt-exact',
        amountCents: 9700,
        postedAt: '2026-06-01T08:00:00Z',
        description: 'STONE LIQUIDACAO',
        bankAccountId: STONE_BANK_AC_ID,
      },
      {
        id: 'bt-far',
        amountCents: 9000,
        postedAt: '2026-06-05T08:00:00Z',
        description: 'desconhecido',
        bankAccountId: STONE_BANK_AC_ID,
      },
    ]
    const r = suggestSettlementMatches(sampleSale, txs, { maxResults: 3 })
    expect(r).toHaveLength(3)
    expect(r[0]!.bankTx.id).toBe('bt-exact')
  })
})

describe('detectDivergences', () => {
  it('vendas com settlement > thresholdDays atrás + sem actual ficam flag', () => {
    const sales = [
      {
        ...sampleSale,
        id: 'overdue',
        expectedSettlementDate: '2026-05-01',
        reconciledAt: null,
        actualSettlementDate: null,
      },
      {
        ...sampleSale,
        id: 'fine',
        expectedSettlementDate: '2026-06-01',
        reconciledAt: null,
        actualSettlementDate: null,
      },
    ]
    const r = detectDivergences(sales, { today: '2026-05-15', thresholdDays: 2 })
    expect(r).toHaveLength(1)
    expect(r[0]!.saleId).toBe('overdue')
    expect(r[0]!.daysOverdue).toBe(14)
  })

  it('venda já reconciliada ignorada', () => {
    const sales = [
      {
        ...sampleSale,
        id: 'ok',
        expectedSettlementDate: '2026-05-01',
        reconciledAt: '2026-05-02T08:00:00Z',
        actualSettlementDate: '2026-05-01',
      },
    ]
    const r = detectDivergences(sales, { today: '2026-06-01' })
    expect(r).toHaveLength(0)
  })
})
