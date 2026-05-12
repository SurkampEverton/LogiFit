import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@repo/auth/server'

/**
 * /meu/sessoes — gerenciamento de sessões ativas (ADR 0073).
 *
 * Lista dispositivos onde o user está logado. Permite:
 *   - Encerrar sessão específica (revoke por device)
 *   - "Encerrar todas as outras" (force-logout cross-device, mantém atual)
 *   - Trocar senha invalida TODAS as sessões (BetterAuth nativo)
 *
 * Sprint 01a Faixa C: skeleton. Implementação completa exige UI de tabela
 * responsiva — vem na Faixa D quando design system "Equilíbrio Vital" tiver
 * `<ResponsiveTable>` (regra 31).
 */
export default async function SessoesPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    redirect('/login?returnTo=/meu/sessoes')
  }

  // TODO Sprint 01a Faixa D: listar todas as sessões do user via
  // auth.api.listSessions({ headers, userId: session.user.id })
  // e renderizar em <ResponsiveTable> com colunas: device, IP, last_seen, revoke.

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Suas sessões ativas</h1>
        <p className="text-base text-[color:var(--ev-text-muted)]">
          Dispositivos onde você está logado. Se vir algum desconhecido, encerre imediatamente.
        </p>
      </header>

      <section
        aria-labelledby="active-sessions"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6"
      >
        <h2 id="active-sessions" className="sr-only">
          Sessões ativas
        </h2>
        <p className="text-sm rounded-md border border-dashed border-[color:var(--ev-border)] p-3 text-[color:var(--ev-text-muted)]">
          Listagem completa em <code>&lt;ResponsiveTable&gt;</code> entra na
          Sprint 01a Faixa D.
        </p>
      </section>

      <section className="text-sm text-[color:var(--ev-text-muted)]">
        <p>
          Sessão atual: <code>{session.session.id.slice(0, 8)}...</code> ·{' '}
          ativa desde {new Date(session.session.createdAt).toLocaleString('pt-BR')}
        </p>
      </section>
    </main>
  )
}
