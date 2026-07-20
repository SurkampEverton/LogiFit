'use server'

/**
 * Server Actions — convite de contador externo (Sprint 01c, ADR 0103 + ADR 0061).
 *
 * Gate `fiscal.admin` (quem configura o fiscal convida o contador). Token de
 * 32 bytes vai só no email (`/convite/{token}`); banco guarda sha256. Convite
 * pendente anterior pro mesmo email é revogado automaticamente ao recriar.
 */

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@repo/db/client'
import { userInvites, users } from '@repo/db/schema'
import { sendTransactional } from '@repo/email'
import { ApiException } from '@repo/errors'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '../../../lib/permissions'
import { wrapServerAction } from '../../../lib/wrap-action'

const CreateInviteSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(2).max(200).optional(),
})

const InviteIdSchema = z.object({ id: z.string().uuid() })

const INVITE_TTL_DAYS = 7

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const createContadorInvite = wrapServerAction(
  { module: 'settings', action: 'contador_invite.create', resourceType: 'user_invite' },
  async (input: z.infer<typeof CreateInviteSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = CreateInviteSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const email = parsed.email.toLowerCase().trim()

    // Email já é user deste tenant? (username = email — convenção Sprint 01a)
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.username, email)))
      .limit(1)
    if (existingUser)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Este email já é usuário do tenant — atribua a role em Usuários',
        request_id: '',
      })

    // Revoga pendente anterior (unique parcial por tenant+email)
    await db
      .update(userInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userInvites.tenantId, tenantId),
          eq(userInvites.email, email),
          isNull(userInvites.acceptedAt),
          isNull(userInvites.revokedAt),
        ),
      )

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

    const [invite] = await db
      .insert(userInvites)
      .values({
        tenantId,
        email,
        name: parsed.name ?? null,
        roleKey: 'contador_externo',
        tokenHash: hashToken(token),
        invitedByUserId: session.logifit.userId,
        expiresAt,
      })
      .returning({ id: userInvites.id })
    if (!invite)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao gravar convite',
        request_id: '',
      })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'
    const acceptUrl = `${appUrl}/convite/${token}`
    await sendTransactional({
      to: email,
      subject: `Convite: portal do contador — ${session.logifit.tenantName}`,
      htmlBody: [
        `<p>Olá${parsed.name ? ` ${parsed.name}` : ''},</p>`,
        `<p><strong>${session.logifit.tenantName}</strong> convidou você pro portal do contador no LogiFit (acesso somente leitura a dados fiscais e financeiros).</p>`,
        `<p><a href="${acceptUrl}">Aceitar convite e criar acesso</a></p>`,
        `<p>O link expira em ${INVITE_TTL_DAYS} dias. Se você não esperava este convite, ignore este email.</p>`,
      ].join('\n'),
      category: 'platform',
    })

    setAuditResource(invite.id, { email, roleKey: 'contador_externo' })
    return { id: invite.id, email, expiresAt: expiresAt.toISOString() }
  },
)

export const listContadorInvites = wrapServerAction(
  { module: 'settings', action: 'contador_invite.list', resourceType: 'user_invite' },
  async (_input: Record<string, never>, { session }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const rows = await db
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
    return { rows }
  },
)

export const revokeContadorInvite = wrapServerAction(
  { module: 'settings', action: 'contador_invite.revoke', resourceType: 'user_invite' },
  async (input: z.infer<typeof InviteIdSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = InviteIdSchema.parse(input)
    const [row] = await db
      .update(userInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userInvites.id, parsed.id),
          eq(userInvites.tenantId, session.logifit.tenantId),
          isNull(userInvites.acceptedAt),
          isNull(userInvites.revokedAt),
        ),
      )
      .returning({ id: userInvites.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Convite não encontrado ou já aceito/revogado',
        request_id: '',
      })
    setAuditResource(row.id, { action: 'revoke' })
    return { id: row.id }
  },
)
