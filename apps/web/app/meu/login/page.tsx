/**
 * /meu/login — pedido de magic link. Sprint 26 Faixa C.
 *
 * Form simples: email → server action requestMagicLink → tela "verifique seu
 * email". Anti-enumeration: resposta idêntica se email existe ou não.
 */
import { headers } from 'next/headers'
import { MagicLinkForm } from './magic-link-form'

export const dynamic = 'force-dynamic'

export default async function MeuLoginPage() {
  // Resolve tenant slug do subdomínio (ADR 0065)
  const h = await headers()
  const host = h.get('host') ?? ''
  const slug = host.split('.')[0] ?? 'default'

  return (
    <div className="ev-portal-page ev-portal-login">
      <h1 className="ev-portal-h1">Acesse seu portal</h1>
      <p className="ev-portal-muted">
        Digite seu email cadastrado. Vamos enviar um link de acesso que vale por 15 minutos.
      </p>
      <MagicLinkForm tenantSlug={slug} />
    </div>
  )
}
