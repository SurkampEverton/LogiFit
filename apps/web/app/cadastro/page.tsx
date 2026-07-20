/**
 * /cadastro — cadastro proativo Path B (Sprint 02b backbone — ADR 0077 + regra 42).
 *
 * Rota pública (sem auth). Visitor anônimo cria conta LogiFit sem precisar
 * de invite. Fluxo 2-step:
 *   1. Phone + Turnstile → requestSmsCode envia OTP (mock dev / Twilio prod)
 *   2. Code + dados completos (name + cpf + email + password) → verifySmsCode
 *      + signupPatient (stub até Sprint 02b2 — ADR persons-without-tenant)
 *
 * **MVP**: Server Component render apenas; <CadastroForm> client interativo.
 * Sprint 02b2 ativa signup real + RIPD DPO sign-off + Turnstile/Twilio prod.
 */
import Link from 'next/link'
import { CadastroForm } from './cadastro-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ invite?: string }>
}

export default async function CadastroPage({ searchParams }: PageProps) {
  const { invite } = await searchParams

  return (
    <div className="ev-portal-page" style={{ padding: 'var(--ev-space-lg)', maxWidth: 480 }}>
      <header style={{ marginBottom: 'var(--ev-space-lg)' }}>
        <h1 className="ev-portal-h1" style={{ marginBottom: 'var(--ev-space-2)' }}>
          Criar conta LogiFit
        </h1>
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Sua identidade fica com você. Cada empresa que você se conecta vê apenas o que você
          autorizar.
        </p>
      </header>

      {invite ? (
        <section
          className="ev-card"
          style={{
            padding: 'var(--ev-space-md)',
            borderLeft: '3px solid var(--ev-primary)',
            marginBottom: 'var(--ev-space-md)',
          }}
        >
          <strong>Convite ativo</strong>
          <p style={{ margin: '4px 0 0 0', fontSize: 'var(--ev-text-sm)' }}>
            Você foi convidado. Após criar sua conta, podemos vincular ao convite{' '}
            <code>{invite.slice(0, 8)}…</code> automaticamente.
          </p>
        </section>
      ) : null}

      <CadastroForm inviteToken={invite ?? null} />

      <section
        style={{
          marginTop: 'var(--ev-space-lg)',
          padding: 'var(--ev-space-md)',
          background: 'var(--ev-surface-muted)',
          borderRadius: 'var(--ev-radius-sm)',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 'var(--ev-text-sm)' }}>O que você ganha</h3>
        <ul style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)', margin: 0 }}>
          <li>Acessa seu histórico em qualquer empresa parceira da LogiFit</li>
          <li>Recebe alertas se prescrições conflitarem entre profissionais</li>
          <li>Revoga acesso a qualquer momento em /meu/privacidade</li>
          <li>Notas privadas do profissional + dados financeiros nunca cruzam empresas</li>
        </ul>
      </section>

      <p
        style={{
          marginTop: 'var(--ev-space-md)',
          fontSize: 'var(--ev-text-xs)',
          color: 'var(--ev-text-muted)',
          textAlign: 'center',
        }}
      >
        Já tem conta? <Link href="/meu/login">Entrar →</Link>
      </p>

      <p
        style={{
          marginTop: 'var(--ev-space-sm)',
          fontSize: 'var(--ev-text-xs)',
          color: 'var(--ev-warning)',
          textAlign: 'center',
        }}
      >
        ⚠ Esta é uma versão backbone (Sprint 02b). Cadastro completo será habilitado em Sprint 02b2
        (depende ADR persons-without-tenant + Twilio/Turnstile prod).
      </p>
    </div>
  )
}
