/**
 * `requireMemberOrPassport` — Sprint 02b6.
 *
 * Resolve session do portal `/meu/*` aceitando AMBOS Sprint 26 member (com
 * tenant + member linkados) E Sprint 02b3 passport global (paciente sem
 * vínculo clínico ainda — cadastro proativo Path B).
 *
 * Retorna discriminated union:
 *   - `kind: 'member'` — comportamento Sprint 26 preserved; page usa
 *     `claims.tenantId` + `claims.memberId` direto
 *   - `kind: 'passport_needs_link'` — paciente passport sem vínculo
 *     ativo; page deve renderizar `<PassportNeedsLink>` (UX graceful em
 *     vez de quebrar)
 *
 * Se session ausente → redirect `/meu/login?returnTo=<path>` (mesma
 * lógica de `requireMemberSession`).
 *
 * **Roadmap Sprint 02b7+:** evoluir pra opção (C) híbrida do ADR 0077:
 *   - passport com 1 link ativo → auto-resolve member context
 *   - passport com >1 link → seletor UI via cookie `lf_active_tenant_id`
 * Por enquanto, opção (A) UX graceful — paciente vê banner "vincule-se"
 * e clica pra `/meu/privacidade/compartilhamento`.
 */
import { redirect } from 'next/navigation'
import { getActiveSession } from './active-session'
import type { MemberSessionClaims } from './member-session'

export type MemberOrPassportClaims =
  | { kind: 'member'; claims: MemberSessionClaims }
  | {
      kind: 'passport_needs_link'
      passportGlobalId: string
      passportSessionId: string
    }

export async function requireMemberOrPassport(
  returnTo: string,
): Promise<MemberOrPassportClaims> {
  const session = await getActiveSession()
  if (!session) {
    const url = new URL('/meu/login', 'http://placeholder')
    url.searchParams.set('returnTo', returnTo)
    redirect(`${url.pathname}${url.search}`)
  }

  if (session.kind === 'member') {
    return { kind: 'member', claims: session.member }
  }

  // session.kind === 'passport' — paciente sem vínculo clínico ativo.
  // Sprint 02b7 evolui pra resolver tenant ativo se houver patient_company_links.
  return {
    kind: 'passport_needs_link',
    passportGlobalId: session.passport.passportGlobalId,
    passportSessionId: session.passport.sessionId,
  }
}
