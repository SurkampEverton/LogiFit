/**
 * `/convite/[token]` — aceite público de convite de staff (Sprint 01c, ADR 0103).
 *
 * Server Component valida o token (hash + TTL + estado) e mostra o form; o
 * provisioning acontece em `POST /api/invites/accept`. Token inválido mostra
 * mensagem genérica (não vaza se expirou, foi revogado ou nunca existiu).
 */
import { createHash } from 'node:crypto'
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { AcceptInviteForm } from './accept-form'

export const dynamic = 'force-dynamic'

interface InviteInfo {
  email: string
  name: string | null
  tenant_name: string
}

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const valid = /^[0-9a-f]{64}$/.test(token)

  let invite: InviteInfo | null = null
  if (valid) {
    const { rows } = await pool.query<InviteInfo>(
      `SELECT i.email, i.name, t.name AS tenant_name
       FROM user_invites i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > now()
       LIMIT 1`,
      [createHash('sha256').update(token).digest('hex')],
    )
    invite = rows[0] ?? null
  }

  return (
    <main
      className="ev-stack"
      style={{ maxWidth: '32rem', margin: '0 auto', padding: 'var(--ev-space-xl)' }}
    >
      {!invite ? (
        <section className="ev-card">
          <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>Convite indisponível</h1>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Este convite é inválido, expirou ou já foi utilizado. Peça um novo convite a quem
            administra a conta.
          </p>
          <Link href="/login" className="ev-btn">
            Ir para o login
          </Link>
        </section>
      ) : (
        <section className="ev-card">
          <h1 style={{ marginTop: 0, fontSize: 'var(--ev-text-2xl)' }}>Aceitar convite</h1>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            <strong>{invite.tenant_name}</strong> convidou <strong>{invite.email}</strong> para o
            portal do contador — acesso <strong>somente leitura</strong> a dados fiscais e
            financeiros, sem acesso clínico.
          </p>
          <AcceptInviteForm token={token} email={invite.email} suggestedName={invite.name ?? ''} />
        </section>
      )}
    </main>
  )
}
