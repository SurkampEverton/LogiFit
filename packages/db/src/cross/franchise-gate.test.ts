/**
 * canCrossModuleAlert + isActionableCid — Sprint 27 Faixa B.1 unit tests.
 */
import { describe, expect, it } from 'vitest'
import { canCrossModuleAlert, isActionableCid } from './franchise-gate'

describe('canCrossModuleAlert — gates', () => {
  const baseHappy = {
    topology: 'owned' as const,
    sourceCompanyId: 'c1',
    targetCompanyId: 'c1',
    hasConsent: true,
    hasActiveAcademiaContract: true,
    hasActiveWorkout: true,
  }

  it('happy path OK', () => {
    const r = canCrossModuleAlert(baseHappy)
    expect(r.ok).toBe(true)
  })

  it('owned + companies diferentes OK', () => {
    const r = canCrossModuleAlert({ ...baseHappy, targetCompanyId: 'c2' })
    expect(r.ok).toBe(true)
  })

  it('franchise mesma company OK', () => {
    const r = canCrossModuleAlert({ ...baseHappy, topology: 'franchise' })
    expect(r.ok).toBe(true)
  })

  it('franchise + companies diferentes → bloqueado regra 25', () => {
    const r = canCrossModuleAlert({
      ...baseHappy,
      topology: 'franchise',
      targetCompanyId: 'c2',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedReason).toBe('regra_25_franchise_cross_company')
  })

  it('regra 25 domina mesmo com consent ativo', () => {
    const r = canCrossModuleAlert({
      ...baseHappy,
      topology: 'franchise',
      targetCompanyId: 'c2',
      hasConsent: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedReason).toBe('regra_25_franchise_cross_company')
  })

  it('sem consent → bloqueado consent_missing', () => {
    const r = canCrossModuleAlert({ ...baseHappy, hasConsent: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedReason).toBe('consent_missing')
  })

  it('sem contrato academia → bloqueado no_active_academia_contract', () => {
    const r = canCrossModuleAlert({ ...baseHappy, hasActiveAcademiaContract: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedReason).toBe('no_active_academia_contract')
  })

  it('sem workout ativo → bloqueado no_active_workout', () => {
    const r = canCrossModuleAlert({ ...baseHappy, hasActiveWorkout: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedReason).toBe('no_active_workout')
  })
})

describe('isActionableCid — filtro de CIDs relevantes', () => {
  it('MG (musculoesquelético) → actionable', () => {
    expect(isActionableCid('MG', 'MG30.0')).toBe(true)
  })

  it('FA (dor crônica) → actionable', () => {
    expect(isActionableCid('FA', 'FA20.5')).toBe(true)
  })

  it('FB (neurológico) → actionable', () => {
    expect(isActionableCid('FB', 'FB28.0')).toBe(true)
  })

  it('22 (lesões) → actionable', () => {
    expect(isActionableCid(null, '22A.1')).toBe(true)
  })

  it('NB (lesão de cabeça/pescoço/tronco) → actionable', () => {
    expect(isActionableCid('NB', 'NB30.0')).toBe(true)
  })

  it('cardiovascular BD → NÃO actionable', () => {
    expect(isActionableCid('BD', 'BD40.0')).toBe(false)
  })

  it('saúde mental MA → NÃO actionable', () => {
    expect(isActionableCid('MA', 'MA02.0')).toBe(false)
  })

  it('chapter null mas code começa com chapter conhecido', () => {
    expect(isActionableCid(null, 'MG30.0')).toBe(true)
    expect(isActionableCid(null, 'BD40.0')).toBe(false)
  })
})
