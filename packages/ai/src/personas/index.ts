/**
 * 7 personas + inferência (ADR 0075).
 */
import type { AssistantPersona, TenantContext } from '../types'
import { adminPersona } from './admin'
import { clinicalPersona } from './professional-clinical'
import { coachPersona } from './professional-coach'
import { contadorExternoPersona } from './contador-externo'
import { dpoPersona } from './dpo'
import { memberPersona } from './member'
import { recepcaoPersona } from './recepcao'
import { superAdminPersona } from './super-admin'

export const PERSONAS = {
  member: memberPersona,
  professional_clinical: clinicalPersona,
  professional_coach: coachPersona,
  admin: adminPersona,
  recepcao: recepcaoPersona,
  super_admin: superAdminPersona,
  contador_externo: contadorExternoPersona,
  dpo: dpoPersona,
} as const satisfies Record<AssistantPersona, { key: AssistantPersona; prompts: Record<string, string> }>

export function getPersonaPrompt(
  persona: AssistantPersona,
  locale: TenantContext['locale'] = 'pt-BR',
): string {
  return PERSONAS[persona].prompts[locale]
}

/**
 * `inferPersona(user, tenant)` — escolhe persona default baseado em role + flag.
 *
 * Ordem de precedência:
 *   1. `member` se user.kind=member (alunos/pacientes)
 *   2. `super_admin` se role=super_admin_rede
 *   3. `dpo` se role=dpo
 *   4. `contador_externo` se role=contador_externo
 *   5. `professional_clinical` se role ∈ {medico, fisio, nutri, enfermeiro}
 *   6. `professional_coach` se role=personal
 *   7. `admin` se role=tenant_owner | gerente | financeiro
 *   8. `recepcao` default
 *
 * User com múltiplas roles (admin + médico, p.ex.) pega a primeira que bater
 * — chip switcher na UI troca em runtime.
 */
export interface InferPersonaInput {
  /** Roles ativas do user (RBAC + scope). */
  roles: string[]
  /** True quando user é member (paciente/aluno). */
  isMember?: boolean
}

export function inferPersona(input: InferPersonaInput): AssistantPersona {
  if (input.isMember) return 'member'
  const roleSet = new Set(input.roles)

  if (roleSet.has('super_admin_rede')) return 'super_admin'
  if (roleSet.has('dpo')) return 'dpo'
  if (roleSet.has('contador_externo')) return 'contador_externo'

  if (
    roleSet.has('medico') ||
    roleSet.has('fisio') ||
    roleSet.has('nutri') ||
    roleSet.has('enfermeiro')
  ) {
    return 'professional_clinical'
  }
  if (roleSet.has('personal')) return 'professional_coach'

  if (roleSet.has('tenant_owner') || roleSet.has('gerente') || roleSet.has('financeiro')) {
    return 'admin'
  }

  return 'recepcao'
}

export { memberPersona, clinicalPersona, coachPersona, adminPersona, recepcaoPersona, superAdminPersona, contadorExternoPersona, dpoPersona }
