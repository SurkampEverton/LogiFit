/**
 * `/cadastro/email-erro` — Sprint 02b4 fechamento.
 *
 * Tela amigável quando link de confirmação falha. `?reason=<código>`
 * mapeia pra mensagem human-readable. Sem exposição de stack trace.
 *
 * Sprint 02b5 adiciona botão "reenviar email" (requer SA `resendPassportEmailVerification`).
 */
import Link from 'next/link'

const REASON_MESSAGES: Record<string, { title: string; body: string }> = {
  missing_token: {
    title: 'Link incompleto',
    body: 'O link de confirmação está sem o código. Verifique se você colou o link completo do email.',
  },
  invalid: {
    title: 'Link inválido',
    body: 'Este link de confirmação não é válido. Ele pode ter sido digitado errado ou estar corrompido.',
  },
  not_found: {
    title: 'Link inválido ou expirado',
    body: 'Não conseguimos validar este link. Ele pode ter expirado (válido por 24h) ou já ter sido usado.',
  },
  validation_error: {
    title: 'Não foi possível confirmar',
    body: 'Não foi possível processar a confirmação. Solicite um novo link de confirmação.',
  },
  internal_error: {
    title: 'Erro inesperado',
    body: 'Tivemos um problema interno ao confirmar seu email. Tente novamente em alguns minutos.',
  },
}

export default async function EmailErrorPage(props: {
  searchParams: Promise<{ reason?: string }>
}) {
  const params = await props.searchParams
  const reason = params.reason ?? 'internal_error'
  const msg = REASON_MESSAGES[reason] ?? REASON_MESSAGES.internal_error!

  return (
    <main
      className="ev-portal-page"
      style={{ maxWidth: 480, margin: '40px auto', padding: 'var(--ev-space-md)' }}
    >
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>{msg.title}</h1>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>{msg.body}</p>
        <div style={{ marginTop: 'var(--ev-space-md)', display: 'flex', gap: 'var(--ev-space-2)' }}>
          <Link href="/meu" className="ev-portal-button">
            Ir pro meu portal
          </Link>
          <Link href="/meu/perfil" className="ev-portal-button ev-portal-button--ghost">
            Pedir novo link
          </Link>
        </div>
      </section>
    </main>
  )
}
