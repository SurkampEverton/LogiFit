/**
 * /meu/convidar — paciente convida profissional / empresa (path C ADR 0077).
 * Sprint 26 Faixa C (26b).
 *
 * Permite ao paciente buscar profissional / estabelecimento já cadastrado no
 * LogiFit (autocomplete) ou solicitar convite pra estabelecimento ainda não
 * cadastrado (commercial_lead).
 *
 * MVP: form estático que descreve o fluxo. Sprint 26c: autocomplete de busca
 * com debounce, filtro por cidade + módulo, criação de pedido inverso.
 */
import Link from 'next/link'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

export default async function ConvidarPage() {
  const __ctx = await requireMemberOrPassport('/meu/convidar')
  if (__ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="convidar empresa" hideLinkButtons />
  }

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Convidar profissional ou estabelecimento</h1>
        <p className="ev-portal-muted">
          Você pode pedir que um profissional ou estabelecimento veja seus dados clínicos —
          academia, fisio, nutri, personal ou pilates. Cada vínculo segue as regras LGPD: você
          autoriza módulo a módulo + categoria a categoria de dado, e pode revogar a qualquer
          momento.
        </p>
      </header>

      <div className="ev-portal-callout">
        <h2 className="ev-portal-h2">Em breve</h2>
        <p>
          A busca por profissional dentro do app vai abrir junto com a próxima atualização. Por
          enquanto:
        </p>
        <ul style={{ paddingLeft: 'var(--ev-space-4)' }}>
          <li>Se o estabelecimento já usa LogiFit: peça pra recepção te enviar o convite.</li>
          <li>
            Se ainda não usa: indique nosso site <a href="https://logifit.com.br">logifit.com.br</a>{' '}
            — gente fala com eles.
          </li>
        </ul>
      </div>

      <Link href="/meu/privacidade" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
