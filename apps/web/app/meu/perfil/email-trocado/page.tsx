/**
 * `/meu/perfil/email-trocado` — Sprint 02b5.
 *
 * Tela amigável pós-troca de email. Paciente cai aqui após clicar o link
 * de confirmação enviado pro novo email. Informa que o email antigo foi
 * notificado.
 */
import Link from 'next/link'

export default function EmailChangedPage() {
  return (
    <main
      className="ev-portal-page"
      style={{ maxWidth: 480, margin: '40px auto', padding: 'var(--ev-space-md)' }}
    >
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>
          ✓ Email trocado com sucesso
        </h1>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          O email da sua conta foi atualizado. Próximas comunicações virão pra este endereço.
        </p>
        <p
          className="ev-portal-muted"
          style={{ fontSize: 'var(--ev-text-xs)', marginTop: 'var(--ev-space-md)' }}
        >
          Por segurança, enviamos uma notificação pro seu email anterior avisando da troca.
        </p>
        <div style={{ marginTop: 'var(--ev-space-md)' }}>
          <Link href="/meu/perfil" className="ev-portal-button">
            Voltar pro meu perfil
          </Link>
        </div>
      </section>
    </main>
  )
}
