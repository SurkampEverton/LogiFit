/**
 * /meu/sessoes — DEPRECATED (Sprint 02b6).
 *
 * Originalmente Sprint 01a Faixa C skeleton, planejado pra mostrar sessões
 * ativas do paciente. Funcionalidade migrou pra `/meu/perfil` que mostra
 * sessions ativas (passport + member) com `<PassportSessionRevokeButton>`
 * e `<RevokeSessionButton>`.
 *
 * Esta rota redireciona pra `/meu/perfil` pra preservar URLs antigos
 * (bookmarks, emails antigos com link, etc).
 *
 * Sprint 02b7+ pode deletar este file de vez quando todos os clientes
 * tiverem migrado pro `/meu/perfil`.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function SessoesPage() {
  redirect('/meu/perfil')
}
