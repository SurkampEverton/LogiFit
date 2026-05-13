/**
 * Testes do tool registry — Sprint 06 Faixa B (ADR 0075 + regra 41).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetRegistryForTests,
  getAvailableTools,
  getToolByKey,
  listAllTools,
  registerAITool,
} from './registry'
import type { TenantContext } from './types'

const baseCtx: TenantContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  planTier: 'starter',
  locale: 'pt-BR',
  verticals: ['academia'],
}

afterEach(() => {
  _resetRegistryForTests()
})

describe('registerAITool', () => {
  it('registra tool e expõe via listAllTools', () => {
    registerAITool({
      key: 'test.foo',
      module: 'test',
      layer: 'help',
      label: 'Foo',
      description: 'desc',
      showInPersonas: ['member'],
      requiresConfirmation: false,
    })
    expect(listAllTools()).toHaveLength(1)
    expect(getToolByKey('test.foo')?.key).toBe('test.foo')
  })

  it('sobrescreve registro existente (idempotente)', () => {
    registerAITool({
      key: 'test.bar',
      module: 'test',
      layer: 'help',
      label: 'Bar v1',
      description: 'desc',
      showInPersonas: ['member'],
      requiresConfirmation: false,
    })
    registerAITool({
      key: 'test.bar',
      module: 'test',
      layer: 'help',
      label: 'Bar v2',
      description: 'desc',
      showInPersonas: ['member'],
      requiresConfirmation: false,
    })
    expect(getToolByKey('test.bar')?.label).toBe('Bar v2')
  })

  it('proíbe re-registrar tool bloqueada sem novo bloqueio', () => {
    registerAITool({
      key: 'test.blocked',
      module: 'test',
      layer: 'action',
      label: 'Blocked',
      description: 'desc',
      showInPersonas: ['admin'],
      requiresConfirmation: true,
      blocked: { reason: 'LGPD art. 18 fluxo dedicado' },
    })
    expect(() =>
      registerAITool({
        key: 'test.blocked',
        module: 'test',
        layer: 'action',
        label: 'Blocked Again',
        description: 'desc',
        showInPersonas: ['admin'],
        requiresConfirmation: true,
      }),
    ).toThrow(/ai-blocked/)
  })
})

describe('getAvailableTools', () => {
  it('filtra por persona', () => {
    registerAITool({
      key: 'agenda.cancelMyAppointment',
      module: 'agenda',
      layer: 'action',
      label: 'Cancelar aula',
      description: 'Cancela aula do member',
      showInPersonas: ['member'],
      requiresConfirmation: true,
    })
    registerAITool({
      key: 'agenda.scheduleAppointmentForMember',
      module: 'agenda',
      layer: 'action',
      label: 'Marcar aula',
      description: 'Marca aula pra member',
      showInPersonas: ['recepcao', 'admin'],
      requiresConfirmation: true,
    })

    const memberTools = getAvailableTools({
      persona: 'member',
      tenantCtx: baseCtx,
      permissions: [],
    })
    expect(memberTools.map((t) => t.key)).toEqual(['agenda.cancelMyAppointment'])

    const recepcaoTools = getAvailableTools({
      persona: 'recepcao',
      tenantCtx: baseCtx,
      permissions: [],
    })
    expect(recepcaoTools.map((t) => t.key)).toEqual(['agenda.scheduleAppointmentForMember'])
  })

  it('filtra por requiredPermissions', () => {
    registerAITool({
      key: 'fin.getOverdue',
      module: 'financeiro',
      layer: 'insight',
      label: 'Inadimplentes',
      description: 'Lista inadimplentes',
      showInPersonas: ['admin'],
      requiresConfirmation: false,
      requiredPermissions: ['financeiro.read'],
    })
    expect(
      getAvailableTools({ persona: 'admin', tenantCtx: baseCtx, permissions: [] }),
    ).toHaveLength(0)
    expect(
      getAvailableTools({
        persona: 'admin',
        tenantCtx: baseCtx,
        permissions: ['financeiro.read'],
      }),
    ).toHaveLength(1)
  })

  it('filtra por requiredVertical', () => {
    registerAITool({
      key: 'fisio.findCid',
      module: 'fisio',
      layer: 'help',
      label: 'Buscar CID',
      description: 'Busca CID-11 por descrição',
      showInPersonas: ['professional_clinical'],
      requiresConfirmation: false,
      requiredVertical: 'fisio',
    })
    expect(
      getAvailableTools({
        persona: 'professional_clinical',
        tenantCtx: { ...baseCtx, verticals: ['academia'] },
        permissions: [],
      }),
    ).toHaveLength(0)
    expect(
      getAvailableTools({
        persona: 'professional_clinical',
        tenantCtx: { ...baseCtx, verticals: ['fisio'] },
        permissions: [],
      }),
    ).toHaveLength(1)
  })

  it('exclui tools blocked', () => {
    registerAITool({
      key: 'member.delete',
      module: 'members',
      layer: 'action',
      label: 'Apagar member',
      description: 'PERIGO',
      showInPersonas: ['admin'],
      requiresConfirmation: true,
      blocked: { reason: 'LGPD art. 18' },
    })
    expect(
      getAvailableTools({ persona: 'admin', tenantCtx: baseCtx, permissions: [] }),
    ).toHaveLength(0)
  })

  it('whenAvailable=false esconde tool', () => {
    registerAITool({
      key: 'agenda.weekend.only',
      module: 'agenda',
      layer: 'help',
      label: 'Só fim de semana',
      description: 'demo',
      showInPersonas: ['member'],
      requiresConfirmation: false,
      whenAvailable: () => false,
    })
    expect(
      getAvailableTools({ persona: 'member', tenantCtx: baseCtx, permissions: [] }),
    ).toHaveLength(0)
  })
})
