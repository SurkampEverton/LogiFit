/**
 * commission.ts tests — Sprint 23 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  type CommissionContract,
  type CommissionEvent,
  type CommissionRuleRow,
  aggregateEntries,
  calculateCommission,
  resolveRule,
} from './commission'

const baseContract: CommissionContract = {
  id: 'contract-1',
  personId: 'person-1',
  userId: 'user-1',
  companyId: 'company-1',
  serviceType: 'fisioterapia',
  kind: 'percent_recebido',
  base: 'recebido_particular',
  defaultPercent: 60,
  defaultAmountCents: null,
  active: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
}

const baseEvent: CommissionEvent = {
  kind: 'payment_received',
  amountCents: 10000,
  ref: 'payment:abc-123',
  serviceType: 'fisioterapia',
  tussCode: '20104073',
  occurredAt: '2026-05-15T10:00:00Z',
  paymentSource: 'particular',
}

describe('calculateCommission — kind=percent_recebido', () => {
  it('payment particular 100 reais × 60% = 60 reais', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: baseContract,
      rules: [],
      today: '2026-05-17',
    })
    expect(r.entry).not.toBeNull()
    expect(r.entry!.commissionCents).toBe(6000)
    expect(r.entry!.percentApplied).toBe(60)
    expect(r.entry!.netAmountCents).toBe(6000) // sem retenção MVP
  })

  it('payment convênio com base=recebido_particular → skip', () => {
    const r = calculateCommission({
      event: { ...baseEvent, paymentSource: 'convenio' },
      contract: baseContract,
      rules: [],
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('paymentSource')
  })

  it('contrato com base=misto aceita ambos', () => {
    const r = calculateCommission({
      event: { ...baseEvent, paymentSource: 'convenio' },
      contract: { ...baseContract, base: 'misto' },
      rules: [],
    })
    expect(r.entry).not.toBeNull()
  })

  it('guide_paid com base=recebido_convenio funciona', () => {
    const r = calculateCommission({
      event: { ...baseEvent, kind: 'guide_paid', paymentSource: 'convenio' },
      contract: { ...baseContract, base: 'recebido_convenio' },
      rules: [],
    })
    expect(r.entry).not.toBeNull()
  })

  it('rule override por tussCode prevalece sobre default', () => {
    const rules: CommissionRuleRow[] = [
      {
        id: 'r1',
        contractId: 'contract-1',
        serviceType: null,
        tussCode: '20104073',
        percent: 80,
        amountCents: null,
        priority: 10,
        active: true,
      },
    ]
    const r = calculateCommission({ event: baseEvent, contract: baseContract, rules })
    expect(r.entry!.commissionCents).toBe(8000)
    expect(r.entry!.percentApplied).toBe(80)
  })

  it('value zero → skip', () => {
    const r = calculateCommission({
      event: { ...baseEvent, amountCents: 0 },
      contract: baseContract,
      rules: [],
    })
    expect(r.entry).toBeNull()
  })
})

describe('calculateCommission — kind=percent_faturamento', () => {
  it('invoice_issued 200 reais × 50% = 100 reais', () => {
    const r = calculateCommission({
      event: {
        ...baseEvent,
        kind: 'invoice_issued',
        amountCents: 20000,
        paymentSource: null,
      },
      contract: {
        ...baseContract,
        kind: 'percent_faturamento',
        base: 'faturado',
        defaultPercent: 50,
      },
      rules: [],
    })
    expect(r.entry).not.toBeNull()
    expect(r.entry!.commissionCents).toBe(10000)
  })

  it('payment_received com kind=percent_faturamento → skip', () => {
    const r = calculateCommission({
      event: baseEvent, // kind=payment_received
      contract: {
        ...baseContract,
        kind: 'percent_faturamento',
        base: 'faturado',
      },
      rules: [],
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('percent_faturamento')
  })
})

describe('calculateCommission — kind=fixo_por_atendimento', () => {
  const fixedContract: CommissionContract = {
    ...baseContract,
    kind: 'fixo_por_atendimento',
    base: 'recebido_particular',
    defaultPercent: null,
    defaultAmountCents: 5000, // R$ 50 por atendimento
  }

  it('appointment_completed → R$ 50', () => {
    const r = calculateCommission({
      event: {
        ...baseEvent,
        kind: 'appointment_completed',
        amountCents: 0, // ignorado
      },
      contract: fixedContract,
      rules: [],
    })
    expect(r.entry).not.toBeNull()
    expect(r.entry!.commissionCents).toBe(5000)
    expect(r.entry!.percentApplied).toBeNull()
  })

  it('rule override valor fixo prevalece', () => {
    const rules: CommissionRuleRow[] = [
      {
        id: 'r1',
        contractId: 'contract-1',
        serviceType: 'fisioterapia',
        tussCode: null,
        percent: null,
        amountCents: 7500,
        priority: 10,
        active: true,
      },
    ]
    const r = calculateCommission({
      event: { ...baseEvent, kind: 'consulta_signed', amountCents: 0 },
      contract: fixedContract,
      rules,
    })
    expect(r.entry!.commissionCents).toBe(7500)
  })

  it('payment_received com kind=fixo_por_atendimento → skip', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: fixedContract,
      rules: [],
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('fixo_por_atendimento')
  })
})

describe('calculateCommission — kind=tabela_por_servico', () => {
  const tableContract: CommissionContract = {
    ...baseContract,
    kind: 'tabela_por_servico',
    base: 'misto',
    defaultPercent: null,
    defaultAmountCents: null,
  }

  it('exige rule — sem rule → skip com motivo', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: tableContract,
      rules: [],
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('tabela_por_servico')
  })

  it('rule com amount fixo aplica', () => {
    const rules: CommissionRuleRow[] = [
      {
        id: 'r1',
        contractId: 'contract-1',
        serviceType: 'fisioterapia',
        tussCode: '20104073',
        percent: null,
        amountCents: 4500,
        priority: 10,
        active: true,
      },
    ]
    const r = calculateCommission({ event: baseEvent, contract: tableContract, rules })
    expect(r.entry!.commissionCents).toBe(4500)
  })

  it('rule com percent aplica %', () => {
    const rules: CommissionRuleRow[] = [
      {
        id: 'r1',
        contractId: 'contract-1',
        serviceType: 'fisioterapia',
        tussCode: '20104073',
        percent: 75,
        amountCents: null,
        priority: 10,
        active: true,
      },
    ]
    const r = calculateCommission({ event: baseEvent, contract: tableContract, rules })
    expect(r.entry!.commissionCents).toBe(7500)
    expect(r.entry!.percentApplied).toBe(75)
  })
})

describe('calculateCommission — vigência', () => {
  it('contrato inativo → skip', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: { ...baseContract, active: false },
      rules: [],
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('Contrato inativo')
  })

  it('contrato ainda não vigente → skip', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: { ...baseContract, effectiveFrom: '2027-01-01' },
      rules: [],
      today: '2026-05-17',
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('vigente')
  })

  it('contrato vencido → skip', () => {
    const r = calculateCommission({
      event: baseEvent,
      contract: { ...baseContract, effectiveTo: '2026-01-01' },
      rules: [],
      today: '2026-05-17',
    })
    expect(r.entry).toBeNull()
    expect(r.skipReason).toContain('vencido')
  })
})

describe('resolveRule — priority', () => {
  const rules: CommissionRuleRow[] = [
    {
      id: 'r-generic',
      contractId: 'c1',
      serviceType: 'fisioterapia',
      tussCode: null,
      percent: 50,
      amountCents: null,
      priority: 100,
      active: true,
    },
    {
      id: 'r-specific',
      contractId: 'c1',
      serviceType: 'fisioterapia',
      tussCode: '20104073',
      percent: 70,
      amountCents: null,
      priority: 10,
      active: true,
    },
  ]

  it('rule mais específica (tuss+service) prevalece', () => {
    const r = resolveRule({ serviceType: 'fisioterapia', tussCode: '20104073' }, rules)
    expect(r?.id).toBe('r-specific')
  })

  it('match só por tussCode quando service não tem rule específica', () => {
    const r = resolveRule({ serviceType: 'outro', tussCode: '20104073' }, rules)
    expect(r?.id).toBe('r-specific')
  })

  it('fallback rule serviceType-only', () => {
    const r = resolveRule({ serviceType: 'fisioterapia', tussCode: 'outro' }, rules)
    expect(r?.id).toBe('r-generic')
  })

  it('rule inativa ignorada', () => {
    const r = resolveRule(
      { serviceType: 'fisioterapia', tussCode: null },
      rules.map((r) => ({ ...r, active: r.id === 'r-generic' ? false : r.active })),
    )
    expect(r).toBeNull()
  })

  it('sem match → null', () => {
    const r = resolveRule({ serviceType: 'nutricao', tussCode: '50000470' }, rules)
    expect(r).toBeNull()
  })
})

describe('aggregateEntries', () => {
  it('soma entries included + pending', () => {
    const r = aggregateEntries([
      { commissionCents: 5000, retentionTotalCents: 500, netAmountCents: 4500, status: 'included' },
      { commissionCents: 3000, retentionTotalCents: 300, netAmountCents: 2700, status: 'pending' },
      { commissionCents: 2000, retentionTotalCents: 200, netAmountCents: 1800, status: 'excluded' },
      { commissionCents: 1000, retentionTotalCents: 100, netAmountCents: 900, status: 'reversed' },
    ])
    expect(r.totalEntries).toBe(2)
    expect(r.grossTotalCents).toBe(8000)
    expect(r.retentionTotalCents).toBe(800)
    expect(r.netTotalCents).toBe(7200)
  })

  it('com deductions reduz net', () => {
    const r = aggregateEntries(
      [
        {
          commissionCents: 10000,
          retentionTotalCents: 1000,
          netAmountCents: 9000,
          status: 'included',
        },
      ],
      500,
    )
    expect(r.netTotalCents).toBe(8500) // 10000 - 1000 - 500
    expect(r.deductionsCents).toBe(500)
  })

  it('lista vazia retorna zeros', () => {
    const r = aggregateEntries([])
    expect(r.totalEntries).toBe(0)
    expect(r.grossTotalCents).toBe(0)
    expect(r.netTotalCents).toBe(0)
  })
})
