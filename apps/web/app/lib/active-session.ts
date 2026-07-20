/**
 * Active session orchestrator — Sprint 02b3 (ADR 0094 §"Migration path").
 *
 * Resolve session ativa do paciente tentando 2 lugares em ordem:
 *   1. `lf_passport_session` cookie (passport_global_sessions — Sprint 02b3)
 *   2. `lf_member_session` cookie (member_sessions — Sprint 26 ADR 0088 legacy)
 *
 * Retorna discriminated union — caller checa `kind` pra saber qual schema.
 *
 * **Por que orchestrator:**
 *   - Paciente novo (signup proativo Sprint 02b3) tem só passport_global_sessions
 *   - Paciente legado (magic link Sprint 26) tem só member_sessions
 *   - Durante a migração (Fase 1-3 ADR 0094) os 2 coexistem
 *
 * Server Component / Server Action chama `getActiveSession()` e usa o
 * discriminator pra rotar lógica (RLS context, claims, audit).
 *
 * @example
 *   const session = await getActiveSession()
 *   if (!session) redirect('/meu/login')
 *   if (session.kind === 'passport') {
 *     await withPassportContext(session.passport, async () => { ... })
 *   } else {
 *     await withMemberContext(session.member, async () => { ... })
 *   }
 */
import { type MemberSessionClaims, getMemberSession } from './member-session'
import { type PassportSessionClaims, getPassportSession } from './passport-session'

export type ActiveSession =
  | { kind: 'passport'; passport: PassportSessionClaims }
  | { kind: 'member'; member: MemberSessionClaims }

/**
 * Tenta passport session FIRST (cookie distinto resolve cedo); fallback
 * pra member session legacy. Retorna null se nenhuma das duas válida.
 */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const passport = await getPassportSession()
  if (passport) return { kind: 'passport', passport }
  const member = await getMemberSession()
  if (member) return { kind: 'member', member }
  return null
}

/**
 * Helper conveniência — retorna o member_id ou null. Útil quando
 * Server Action só precisa do member contexto e não importa kind.
 *
 * Sprint 02b3 partial: passport session sem member_id retorna null
 * (paciente sem tenant linked). Sprint 02b4 pode resolver "active tenant"
 * via cookie auxiliar + lookup persons espelho.
 */
export async function getMemberIdFromActiveSession(): Promise<string | null> {
  const session = await getActiveSession()
  if (!session) return null
  if (session.kind === 'member') return session.member.memberId
  return null
}
