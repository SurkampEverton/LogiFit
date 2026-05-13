/**
 * Testes do inferPersona — Sprint 06 Faixa B (ADR 0075).
 */
import { describe, expect, it } from 'vitest'
import { getPersonaPrompt, inferPersona } from './personas'

describe('inferPersona', () => {
  it('member quando isMember=true (preferência absoluta)', () => {
    expect(
      inferPersona({ roles: ['medico', 'tenant_owner'], isMember: true }),
    ).toBe('member')
  })

  it('super_admin quando role super_admin_rede', () => {
    expect(inferPersona({ roles: ['super_admin_rede'] })).toBe('super_admin')
  })

  it('dpo quando role dpo', () => {
    expect(inferPersona({ roles: ['dpo'] })).toBe('dpo')
  })

  it('contador_externo quando role contador_externo', () => {
    expect(inferPersona({ roles: ['contador_externo'] })).toBe('contador_externo')
  })

  it('professional_clinical quando médico', () => {
    expect(inferPersona({ roles: ['medico'] })).toBe('professional_clinical')
  })

  it('professional_clinical quando fisio/nutri/enfermeiro', () => {
    expect(inferPersona({ roles: ['fisio'] })).toBe('professional_clinical')
    expect(inferPersona({ roles: ['nutri'] })).toBe('professional_clinical')
    expect(inferPersona({ roles: ['enfermeiro'] })).toBe('professional_clinical')
  })

  it('professional_coach quando personal', () => {
    expect(inferPersona({ roles: ['personal'] })).toBe('professional_coach')
  })

  it('admin quando tenant_owner/gerente/financeiro', () => {
    expect(inferPersona({ roles: ['tenant_owner'] })).toBe('admin')
    expect(inferPersona({ roles: ['gerente'] })).toBe('admin')
    expect(inferPersona({ roles: ['financeiro'] })).toBe('admin')
  })

  it('recepcao como fallback', () => {
    expect(inferPersona({ roles: ['recepcao'] })).toBe('recepcao')
    expect(inferPersona({ roles: [] })).toBe('recepcao')
  })

  it('super_admin precede outras roles', () => {
    expect(
      inferPersona({ roles: ['super_admin_rede', 'tenant_owner', 'medico'] }),
    ).toBe('super_admin')
  })
})

describe('getPersonaPrompt', () => {
  it('retorna pt-BR default', () => {
    const p = getPersonaPrompt('member')
    expect(p).toContain('aluno/paciente')
  })

  it('retorna en-US quando solicitado', () => {
    const p = getPersonaPrompt('member', 'en-US')
    expect(p).toContain("student/patient")
  })

  it('retorna es-419 quando solicitado', () => {
    const p = getPersonaPrompt('member', 'es-419')
    expect(p).toContain('alumno/paciente')
  })

  it('todas as 7 personas têm os 3 locales', () => {
    const personas = [
      'member',
      'professional_clinical',
      'professional_coach',
      'admin',
      'recepcao',
      'super_admin',
      'contador_externo',
      'dpo',
    ] as const
    for (const p of personas) {
      expect(getPersonaPrompt(p, 'pt-BR')).toBeTruthy()
      expect(getPersonaPrompt(p, 'en-US')).toBeTruthy()
      expect(getPersonaPrompt(p, 'es-419')).toBeTruthy()
    }
  })
})
