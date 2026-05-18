/**
 * /meu/login/verify — consome token plano vindo do link. Sprint 26 Faixa C.
 *
 * Server Component: extrai `?t=` da URL → chama verifyMagicLink → seta cookie
 * → redireciona pra `/meu` (ou `?to=` se especificado).
 */
import { redirect } from 'next/navigation'
import { verifyMagicLink } from '../../actions'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ t?: string; to?: string }>
}

export default async function VerifyPage({ searchParams }: Props) {
  const { t, to } = await searchParams

  if (!t) {
    return (
      <div className="ev-portal-page">
        <h1 className="ev-portal-h1">Link inválido</h1>
        <p>Solicite um novo link em /meu/login.</p>
      </div>
    )
  }

  try {
    await verifyMagicLink({ token: t })
  } catch {
    return (
      <div className="ev-portal-page">
        <h1 className="ev-portal-h1">Link inválido ou expirado</h1>
        <p className="ev-portal-muted">
          Esse link pode ter expirado (15 minutos), já ter sido usado, ou ser inválido. Solicite um
          novo.
        </p>
        <a href="/meu/login" className="ev-portal-button">
          Solicitar novo link
        </a>
      </div>
    )
  }

  redirect(to ?? '/meu')
}
