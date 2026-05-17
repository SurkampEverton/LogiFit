import { describe, expect, it } from 'vitest'
import {
  type ApprovalRuleRow,
  type ApprovalTraceEntry,
  canUserApprove,
  decideNextState,
  pickApprovalRule,
} from './approval'

const RULE_AUTO_500: ApprovalRuleRow = {
  id: 'rule-auto',
  minAmountCents: 0,
  maxAmountCents: 50000, // R$ 500
  requiredApprovers: { mode: 'series', approvers: [] },
  companyId: null,
  active: true,
}

const RULE_GERENTE: ApprovalRuleRow = {
  id: 'rule-gerente',
  minAmountCents: 50001,
  maxAmountCents: 500000, // R$ 5000
  requiredApprovers: { mode: 'series', approvers: [{ role: 'gerente_financeiro' }] },
  companyId: null,
  active: true,
}

const RULE_DIRETOR_DUAL: ApprovalRuleRow = {
  id: 'rule-diretor',
  minAmountCents: 500001,
  maxAmountCents: null, // sem teto
  requiredApprovers: {
    mode: 'series',
    approvers: [{ role: 'gerente_financeiro' }, { role: 'diretor' }],
  },
  companyId: null,
  active: true,
}

const RULES = [RULE_AUTO_500, RULE_GERENTE, RULE_DIRETOR_DUAL]

describe('pickApprovalRule', () => {
  it('R$ 100 → rule_auto', () => {
    const r = pickApprovalRule(10000, null, RULES)
    expect(r?.id).toBe('rule-auto')
  })

  it('R$ 1000 → rule_gerente', () => {
    const r = pickApprovalRule(100000, null, RULES)
    expect(r?.id).toBe('rule-gerente')
  })

  it('R$ 10000 → rule_diretor', () => {
    const r = pickApprovalRule(1000000, null, RULES)
    expect(r?.id).toBe('rule-diretor')
  })

  it('amount=0 limítrofe vai pra rule_auto (min=0)', () => {
    const r = pickApprovalRule(0, null, RULES)
    expect(r?.id).toBe('rule-auto')
  })

  it('rule específica de company tem prioridade', () => {
    const ruleCompany: ApprovalRuleRow = {
      id: 'rule-company',
      minAmountCents: 0,
      maxAmountCents: 1000000,
      requiredApprovers: { mode: 'series', approvers: [{ role: 'tenant_owner' }] },
      companyId: 'company-1',
      active: true,
    }
    const r = pickApprovalRule(50000, 'company-1', [...RULES, ruleCompany])
    expect(r?.id).toBe('rule-company')
  })

  it('rule inativa ignorada', () => {
    const inactive: ApprovalRuleRow = { ...RULE_AUTO_500, active: false }
    const r = pickApprovalRule(10000, null, [inactive])
    expect(r).toBeNull()
  })
})

describe('decideNextState — auto-aprovação', () => {
  it('AP R$ 100 sem trace → auto_approved (R$ 500 rule)', () => {
    const r = decideNextState({
      amountCents: 10000,
      companyId: null,
      rules: RULES,
      trace: [],
    })
    expect(r.state).toBe('approved')
    if (r.state === 'approved') {
      expect(r.reason).toBe('auto_approved')
    }
  })

  it('sem rules matching → no_rule_required', () => {
    const r = decideNextState({
      amountCents: 10000,
      companyId: null,
      rules: [],
      trace: [],
    })
    expect(r.state).toBe('approved')
    if (r.state === 'approved') {
      expect(r.reason).toBe('no_rule_required')
    }
  })
})

describe('decideNextState — series 1 aprovador', () => {
  it('AP R$ 1000 sem trace → pending pra gerente', () => {
    const r = decideNextState({
      amountCents: 100000,
      companyId: null,
      rules: RULES,
      trace: [],
    })
    expect(r.state).toBe('pending_approval')
    if (r.state === 'pending_approval' && 'nextApprover' in r) {
      expect(r.nextApprover.role).toBe('gerente_financeiro')
    }
  })

  it('AP R$ 1000 com gerente aprovado → approved', () => {
    const trace: ApprovalTraceEntry[] = [
      {
        at: '2026-05-14T10:00:00Z',
        byUserId: 'user-gerente',
        byRole: 'gerente_financeiro',
        action: 'approved',
      },
    ]
    const r = decideNextState({
      amountCents: 100000,
      companyId: null,
      rules: RULES,
      trace,
    })
    expect(r.state).toBe('approved')
  })
})

describe('decideNextState — series 2 aprovadores', () => {
  it('AP R$ 10000 sem trace → pending gerente (1º na ordem)', () => {
    const r = decideNextState({
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace: [],
    })
    if (r.state === 'pending_approval' && 'nextApprover' in r) {
      expect(r.nextApprover.role).toBe('gerente_financeiro')
    } else {
      throw new Error('Expected pending_approval with nextApprover')
    }
  })

  it('AP R$ 10000 com gerente aprovado → pending diretor (2º)', () => {
    const trace: ApprovalTraceEntry[] = [
      {
        at: '2026-05-14T10:00:00Z',
        byUserId: 'user-gerente',
        byRole: 'gerente_financeiro',
        action: 'approved',
      },
    ]
    const r = decideNextState({
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace,
    })
    if (r.state === 'pending_approval' && 'nextApprover' in r) {
      expect(r.nextApprover.role).toBe('diretor')
    } else {
      throw new Error('Expected pending_approval with diretor')
    }
  })

  it('AP R$ 10000 com gerente+diretor aprovados → approved', () => {
    const trace: ApprovalTraceEntry[] = [
      {
        at: '2026-05-14T10:00:00Z',
        byUserId: 'user-g',
        byRole: 'gerente_financeiro',
        action: 'approved',
      },
      {
        at: '2026-05-14T11:00:00Z',
        byUserId: 'user-d',
        byRole: 'diretor',
        action: 'approved',
      },
    ]
    const r = decideNextState({
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace,
    })
    expect(r.state).toBe('approved')
  })
})

describe('decideNextState — rejeição', () => {
  it('trace com rejected → state=rejected', () => {
    const trace: ApprovalTraceEntry[] = [
      {
        at: '2026-05-14T10:00:00Z',
        byUserId: 'user-g',
        byRole: 'gerente_financeiro',
        action: 'rejected',
        comment: 'Valor acima do orçado',
      },
    ]
    const r = decideNextState({
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace,
    })
    expect(r.state).toBe('rejected')
    if (r.state === 'rejected') {
      expect(r.reason).toBe('Valor acima do orçado')
    }
  })
})

describe('decideNextState — parallel', () => {
  const parallelRule: ApprovalRuleRow = {
    id: 'rule-parallel',
    minAmountCents: 0,
    maxAmountCents: null,
    requiredApprovers: {
      mode: 'parallel',
      approvers: [{ role: 'gerente_a' }, { role: 'gerente_b' }],
    },
    companyId: null,
    active: true,
  }

  it('sem trace → ambos pendentes', () => {
    const r = decideNextState({
      amountCents: 100000,
      companyId: null,
      rules: [parallelRule],
      trace: [],
    })
    if (r.state === 'pending_approval' && 'remainingApprovers' in r) {
      expect(r.remainingApprovers.length).toBe(2)
    } else {
      throw new Error('Expected pending')
    }
  })

  it('1 aprovador → 1 pendente', () => {
    const r = decideNextState({
      amountCents: 100000,
      companyId: null,
      rules: [parallelRule],
      trace: [
        {
          at: '2026-05-14T10:00:00Z',
          byUserId: 'u',
          byRole: 'gerente_a',
          action: 'approved',
        },
      ],
    })
    if (r.state === 'pending_approval' && 'remainingApprovers' in r) {
      expect(r.remainingApprovers.length).toBe(1)
      expect(r.remainingApprovers[0]!.role).toBe('gerente_b')
    } else {
      throw new Error('Expected pending')
    }
  })

  it('ambos aprovaram → approved', () => {
    const r = decideNextState({
      amountCents: 100000,
      companyId: null,
      rules: [parallelRule],
      trace: [
        {
          at: '2026-05-14T10:00:00Z',
          byUserId: 'u1',
          byRole: 'gerente_a',
          action: 'approved',
        },
        {
          at: '2026-05-14T11:00:00Z',
          byUserId: 'u2',
          byRole: 'gerente_b',
          action: 'approved',
        },
      ],
    })
    expect(r.state).toBe('approved')
  })
})

describe('canUserApprove', () => {
  it('gerente pode aprovar quando série espera role gerente', () => {
    const r = canUserApprove({
      userId: 'user-g',
      userRoles: ['gerente_financeiro'],
      amountCents: 100000,
      companyId: null,
      rules: RULES,
      trace: [],
    })
    expect(r.allowed).toBe(true)
  })

  it('diretor não pode aprovar quando série espera gerente (fora de ordem)', () => {
    const r = canUserApprove({
      userId: 'user-d',
      userRoles: ['diretor'],
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace: [],
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/série/)
  })

  it('diretor pode aprovar depois do gerente', () => {
    const r = canUserApprove({
      userId: 'user-d',
      userRoles: ['diretor'],
      amountCents: 1000000,
      companyId: null,
      rules: RULES,
      trace: [
        {
          at: '2026-05-14T10:00:00Z',
          byUserId: 'user-g',
          byRole: 'gerente_financeiro',
          action: 'approved',
        },
      ],
    })
    expect(r.allowed).toBe(true)
  })

  it('AP já approved não permite aprovação', () => {
    const r = canUserApprove({
      userId: 'user-x',
      userRoles: ['gerente_financeiro'],
      amountCents: 10000, // auto-approved range
      companyId: null,
      rules: RULES,
      trace: [],
    })
    expect(r.allowed).toBe(false)
  })
})
