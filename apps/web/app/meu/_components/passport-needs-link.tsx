/**
 * `<PassportNeedsLink>` — UI graceful pra paciente passport sem vínculo
 * clínico (Sprint 02b6).
 *
 * Renderizado quando uma página `/meu/*` é acessada com session passport
 * mas o paciente ainda não tem vínculo ativo com nenhuma empresa
 * (`patient_company_links`). Em vez de quebrar com `requireMemberSession`
 * redirect, mostra banner amigável + CTA pra gerenciar vínculos.
 *
 * Sprint 02b7+ pode evoluir pra (C) híbrido — auto-resolve se 1 link
 * ativo, seletor se >1. Por enquanto opção (A) simples.
 */
import Link from 'next/link'

export interface PassportNeedsLinkProps {
  /** Nome da feature (genitivo) — ex: "seus treinos", "suas avaliações" */
  feature: string
  /** Pra onde voltar após linkar (opcional — paciente pode escolher outra rota) */
  returnTo?: string
  /**
   * Esconde botões de "Convidar empresa" e "Gerenciar vínculos" — pra usar
   * dentro de páginas que JÁ são as próprias rotas dos botões (evita loop
   * de "ir pra mesma página").
   */
  hideLinkButtons?: boolean
}

export function PassportNeedsLink({ feature, hideLinkButtons = false }: PassportNeedsLinkProps) {
  return (
    <main
      className="ev-portal-page"
      style={{ maxWidth: 520, margin: '40px auto', padding: 'var(--ev-space-md)' }}
    >
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>
          🔗 Precisa de vínculo com uma empresa
        </h1>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          Pra ver {feature}, você precisa estar vinculado a uma clínica ou academia que use o
          LogiFit.
        </p>
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Você pode convidar uma empresa, aceitar um convite recebido, ou pedir pra recepção da sua
          clínica te cadastrar.
        </p>
        {!hideLinkButtons ? (
          <div
            style={{
              marginTop: 'var(--ev-space-md)',
              display: 'flex',
              gap: 'var(--ev-space-2)',
              flexWrap: 'wrap',
            }}
          >
            <Link href="/meu/convidar" className="ev-portal-button">
              Convidar empresa
            </Link>
            <Link
              href="/meu/privacidade/compartilhamento"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Gerenciar meus vínculos
            </Link>
          </div>
        ) : null}
        <p
          className="ev-portal-muted"
          style={{ fontSize: 'var(--ev-text-xs)', marginTop: 'var(--ev-space-md)' }}
        >
          Sua conta global LogiFit está ativa — você pode editar dados em{' '}
          <Link href="/meu/perfil" style={{ color: 'inherit' }}>
            /meu/perfil
          </Link>
          .
        </p>
      </section>
    </main>
  )
}
