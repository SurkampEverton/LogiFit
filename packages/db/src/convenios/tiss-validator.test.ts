/**
 * tiss-validator.ts tests — Sprint 22 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import { type ValidateGuideInput, validateGuide } from './tiss-validator'

const VALID: ValidateGuideInput = {
  today: '2026-05-17',
  kind: 'sp_sadt',
  professional: {
    name: 'João Fisio',
    councilBody: 'CREFITO',
    councilState: 'SP',
    councilNumber: '12345',
    cbosCode: '226305',
    specialty: 'fisioterapia',
  },
  memberInsurance: {
    cardNumber: '1234567890',
    validUntil: '2027-12-31',
  },
  authorization: {
    authorizationNumber: 'AUTH-789',
    quantityAuthorized: 10,
    quantityUsed: 2,
    validUntil: '2026-12-31',
    status: 'approved',
  },
  procedurePrice: {
    authRequired: true,
    priceCents: 5500,
    patientCopayCents: 1000,
    maxSessionsPerAuth: 10,
  },
  tussSpecialties: ['fisioterapia'],
  items: [
    {
      tussCode: '20104073',
      quantity: 1,
      unitPriceCents: 5500,
      totalCents: 5500,
      executionDate: '2026-05-17',
    },
  ],
  totalCents: 5500,
  declaredCopayCents: 1000,
  expectedSpecialtyByKind: { sp_sadt: 'fisioterapia' },
}

describe('validateGuide — happy path', () => {
  it('guia válida → ok=true, sem issues error', () => {
    const r = validateGuide(VALID)
    expect(r.ok).toBe(true)
    const errors = r.issues.filter((i) => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })
})

describe('validateGuide — profissional', () => {
  it('sem CBOS → PROF_NO_CBOS', () => {
    const r = validateGuide({ ...VALID, professional: { ...VALID.professional, cbosCode: null } })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'PROF_NO_CBOS')).toBe(true)
  })

  it('sem council body → PROF_NO_COUNCIL', () => {
    const r = validateGuide({
      ...VALID,
      professional: { ...VALID.professional, councilBody: null },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'PROF_NO_COUNCIL')).toBe(true)
  })

  it('sem UF → PROF_NO_UF', () => {
    const r = validateGuide({
      ...VALID,
      professional: { ...VALID.professional, councilState: null },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'PROF_NO_UF')).toBe(true)
  })
})

describe('validateGuide — carteirinha', () => {
  it('sem número → CARD_MISSING', () => {
    const r = validateGuide({
      ...VALID,
      memberInsurance: { ...VALID.memberInsurance, cardNumber: null },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'CARD_MISSING')).toBe(true)
  })

  it('expirada → CARD_EXPIRED', () => {
    const r = validateGuide({
      ...VALID,
      memberInsurance: { ...VALID.memberInsurance, validUntil: '2025-01-01' },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'CARD_EXPIRED')).toBe(true)
  })
})

describe('validateGuide — autorização', () => {
  it('procedimento exige auth mas guia sem authorizationNumber → AUTH_REQUIRED_MISSING', () => {
    const r = validateGuide({
      ...VALID,
      authorization: null,
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'AUTH_REQUIRED_MISSING')).toBe(true)
  })

  it('autorização vencida vs data execução → AUTH_EXPIRED', () => {
    const r = validateGuide({
      ...VALID,
      authorization: { ...VALID.authorization!, validUntil: '2026-01-01' },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'AUTH_EXPIRED')).toBe(true)
  })

  it('quantidade > autorizada → AUTH_QTY_EXCEEDED', () => {
    const r = validateGuide({
      ...VALID,
      authorization: { ...VALID.authorization!, quantityAuthorized: 5, quantityUsed: 4 },
      items: [{ ...VALID.items[0]!, quantity: 5 }],
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'AUTH_QTY_EXCEEDED')).toBe(true)
  })

  it('status != approved → AUTH_NOT_APPROVED', () => {
    const r = validateGuide({
      ...VALID,
      authorization: { ...VALID.authorization!, status: 'pending' },
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'AUTH_NOT_APPROVED')).toBe(true)
  })
})

describe('validateGuide — totais', () => {
  it('TOTAL_MISMATCH quando soma itens != totalCents', () => {
    const r = validateGuide({ ...VALID, totalCents: 9999 })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'TOTAL_MISMATCH')).toBe(true)
  })

  it('ITEM_TOTAL_MISMATCH quando quantity × unitPrice != totalCents', () => {
    const r = validateGuide({
      ...VALID,
      items: [{ ...VALID.items[0]!, quantity: 2, unitPriceCents: 5500, totalCents: 5500 }],
      totalCents: 5500,
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'ITEM_TOTAL_MISMATCH')).toBe(true)
  })
})

describe('validateGuide — especialidade (warning)', () => {
  it('procedimento TUSS restrito → TUSS_SPECIALTY_MISMATCH warning, ok=true', () => {
    const r = validateGuide({
      ...VALID,
      tussSpecialties: ['medicina'], // exclui fisioterapia
    })
    // É só warning (não bloqueia)
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'TUSS_SPECIALTY_MISMATCH')).toBe(true)
  })

  it('kind expectedSpecialty diferente do profissional → SPECIALTY_MISMATCH warning', () => {
    const r = validateGuide({
      ...VALID,
      expectedSpecialtyByKind: { sp_sadt: 'medicina' },
    })
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'SPECIALTY_MISMATCH')).toBe(true)
  })
})

describe('validateGuide — co-participação (warning)', () => {
  it('copay declarado != tabela → COPAY_MISMATCH warning', () => {
    const r = validateGuide({ ...VALID, declaredCopayCents: 2000 })
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'COPAY_MISMATCH')).toBe(true)
  })
})

describe('validateGuide — múltiplos erros', () => {
  it('agrega todos os erros no array issues', () => {
    const r = validateGuide({
      ...VALID,
      professional: { ...VALID.professional, cbosCode: null, councilBody: null },
      memberInsurance: { cardNumber: null, validUntil: '2024-01-01' },
      authorization: null, // mas procedimento exige
    })
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThanOrEqual(3)
    const codes = r.issues.map((i) => i.code)
    expect(codes).toContain('PROF_NO_CBOS')
    expect(codes).toContain('PROF_NO_COUNCIL')
    expect(codes).toContain('CARD_MISSING')
    expect(codes).toContain('AUTH_REQUIRED_MISSING')
  })
})
