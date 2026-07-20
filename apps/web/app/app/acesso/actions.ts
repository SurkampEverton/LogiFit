'use server'

/**
 * Server Actions de controle de acesso — Sprint 08 Faixa B.
 *
 * - `registerDevice`: catraca cadastrada, retorna token completo 1× (mostrado
 *   no toast pra admin copiar; depois só hash fica no banco)
 * - `revokeDevice`: marca revoked_at + log audit
 * - `blockMember`: cria access_block manual
 * - `unblockMember`: marca resolved_at
 * - `rotateAccessSecret`: nova chave HMAC + arquiva anterior
 *
 * **Token format**: random base64 32 bytes; hash bcrypt salvo. Catraca envia
 * em header `x-device-token` na API `/api/acesso/checkin`.
 */

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@repo/db/client'
import { accessBlocks, accessDevices, accessSecrets } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { generateAccessSecret } from '@repo/security'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const RegisterDeviceInputSchema = z.object({
  companyId: z.string().uuid(),
  unitId: z.string().uuid().optional(),
  label: z.string().min(2).max(120),
  authModes: z.array(z.enum(['qr', 'facial', 'manual'])).default(['qr']),
  hardwareType: z.string().optional(),
})

const RevokeDeviceInputSchema = z.object({ deviceId: z.string().uuid() })

const BlockMemberInputSchema = z.object({
  memberId: z.string().uuid(),
  reason: z.string().min(2).max(500),
  expiresAt: z.string().datetime().optional(),
  kind: z.enum(['manual', 'suspended']).default('manual'),
})

const UnblockMemberInputSchema = z.object({
  blockId: z.string().uuid(),
  resolvedReason: z.string().min(2).max(500),
})

/**
 * Hash sha256 do device token — armazenado em `access_devices.token_hash`.
 * Token plain é mostrado 1× ao admin no register.
 */
function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ─── registerDevice ───────────────────────────────────────────────────────

export const registerDevice = wrapServerAction(
  { module: 'acesso', action: 'device.register', resourceType: 'access_devices' },
  async (input: z.infer<typeof RegisterDeviceInputSchema>, { session }) => {
    const parsed = RegisterDeviceInputSchema.parse(input)
    // Gera device token random 32 bytes
    const deviceToken = randomBytes(32).toString('base64url')
    const tokenHash = hashDeviceToken(deviceToken)

    const [row] = await db
      .insert(accessDevices)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        unitId: parsed.unitId ?? null,
        label: parsed.label,
        tokenHash,
        authModes: parsed.authModes,
        hardwareType: parsed.hardwareType ?? null,
      })
      .returning({ id: accessDevices.id })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao registrar device',
        request_id: '',
      })

    // Garante secret ativo no tenant (cria se primeiro device)
    const existing = await db
      .select({ id: accessSecrets.id })
      .from(accessSecrets)
      .where(
        and(eq(accessSecrets.tenantId, session.logifit.tenantId), eq(accessSecrets.active, true)),
      )
      .limit(1)
    if (existing.length === 0) {
      await db.insert(accessSecrets).values({
        tenantId: session.logifit.tenantId,
        secret: generateAccessSecret(),
        active: true,
      })
    }

    // Token plain retornado SO 1×; admin copia
    return { id: row.id, deviceToken }
  },
)

// ─── revokeDevice ─────────────────────────────────────────────────────────

export const revokeDevice = wrapServerAction(
  { module: 'acesso', action: 'device.revoke' },
  async (input: z.infer<typeof RevokeDeviceInputSchema>, { session }) => {
    const parsed = RevokeDeviceInputSchema.parse(input)
    const [row] = await db
      .update(accessDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(accessDevices.id, parsed.deviceId),
          eq(accessDevices.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: accessDevices.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Device não encontrado',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── blockMember ──────────────────────────────────────────────────────────

export const blockMember = wrapServerAction(
  { module: 'acesso', action: 'block.create' },
  async (input: z.infer<typeof BlockMemberInputSchema>, { session }) => {
    const parsed = BlockMemberInputSchema.parse(input)
    const [row] = await db
      .insert(accessBlocks)
      .values({
        tenantId: session.logifit.tenantId,
        memberId: parsed.memberId,
        kind: parsed.kind,
        reason: parsed.reason,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: accessBlocks.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao bloquear member',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── unblockMember ────────────────────────────────────────────────────────

export const unblockMember = wrapServerAction(
  { module: 'acesso', action: 'block.resolve' },
  async (input: z.infer<typeof UnblockMemberInputSchema>, { session }) => {
    const parsed = UnblockMemberInputSchema.parse(input)
    const [row] = await db
      .update(accessBlocks)
      .set({ resolvedAt: new Date(), resolvedReason: parsed.resolvedReason })
      .where(
        and(
          eq(accessBlocks.id, parsed.blockId),
          eq(accessBlocks.tenantId, session.logifit.tenantId),
          isNull(accessBlocks.resolvedAt),
        ),
      )
      .returning({ id: accessBlocks.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Bloqueio não encontrado ou já resolvido',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── listMemberAccess ─────────────────────────────────────────────────────
// Widget acessos no perfil do member (Sprint 08 Faixa C).

export const listMemberAccess = wrapServerAction(
  { module: 'acesso', action: 'access.list_by_member' },
  async (input: { memberId: string }, { session }) => {
    const memberId = z.string().uuid().parse(input.memberId)
    const blocks = await db
      .select({
        id: accessBlocks.id,
        kind: accessBlocks.kind,
        reason: accessBlocks.reason,
        startedAt: accessBlocks.startedAt,
        expiresAt: accessBlocks.expiresAt,
      })
      .from(accessBlocks)
      .where(
        and(
          eq(accessBlocks.tenantId, session.logifit.tenantId),
          eq(accessBlocks.memberId, memberId),
          isNull(accessBlocks.resolvedAt),
        ),
      )
      .limit(10)

    return { activeBlocks: blocks }
  },
)
