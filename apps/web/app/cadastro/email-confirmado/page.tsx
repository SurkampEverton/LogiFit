/**
 * `/cadastro/email-confirmado` — Sprint 02b4 fechamento.
 *
 * Tela amigável pós-confirmação de email. Renderiza diferente se
 * `?already=1` (paciente clicou link 2x ou já tinha confirmado).
 */
import Link from 'next/link'

export default async function EmailConfirmedPage(props: {
  searchParams: Promise<{ already?: string }>
}) {
  const params = await props.searchParams
  const already = params.already === '1'

  return (
    <main
      className="ev-portal-page"
      style={{ maxWidth: 480, margin: '40px auto', padding: 'var(--ev-space-md)' }}
    >
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>
          {already ? 'Email já estava confirmado' : '✓ Email confirmado!'}
        </h1>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          {already
            ? 'Sua conta já está pronta. Você pode acessar seu portal agora.'
            : 'Sua conta LogiFit está ativada. Bem-vindo ao portal do paciente.'}
        </p>
        <div style={{ marginTop: 'var(--ev-space-md)' }}>
          <Link href="/meu" className="ev-portal-button">
            Ir pro meu portal
          </Link>
        </div>
      </section>
    </main>
  )
}
