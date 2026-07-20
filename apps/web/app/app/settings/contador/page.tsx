/**
 * `/app/settings/contador` — convites de contador externo (Sprint 01c, ADR 0103).
 *
 * Admin convida por email (magic link de aceite, TTL 7d) + lista/revoga.
 * Gate `fiscal.admin` server-side nas SAs; página exige sessão.
 */
import { db } from '@repo/db/client'
import { userInvites } from '@repo/db/schema'
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { InviteManager } from './invite-client'

export const dynamic = 'force-dynamic'

export default async function ContadorInvitesPage() {
  const session = await requireFullSession('/app/settings/contador')

  const invites = await db
    .select({
      id: userInvites.id,
      email: userInvites.email,
      name: userInvites.name,
      expiresAt: userInvites.expiresAt,
      acceptedAt: userInvites.acceptedAt,
      revokedAt: userInvites.revokedAt,
      createdAt: userInvites.createdAt,
    })
    .from(userInvites)
    .where(eq(userInvites.tenantId, session.logifit.tenantId))
    .orderBy(desc(userInvites.createdAt))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Contador externo</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/contador" className="ev-btn ev-btn-ghost">
          Ver portal do contador →
        </Link>
      </header>

      <p style={{ color: 'var(--ev-text-muted)' }}>
        O contador recebe acesso <strong>somente leitura</strong> a dados fiscais e financeiros
        (role <code>contador_externo</code> — ADR 0061). Nunca vê prontuário, agenda ou dados
        clínicos. O convite expira em 7 dias; o primeiro login exige configurar MFA.
      </p>

      <InviteManager
        invites={invites.map((i) => ({
          ...i,
          expiresAt: i.expiresAt.toISOString(),
          acceptedAt: i.acceptedAt?.toISOString() ?? null,
          revokedAt: i.revokedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
