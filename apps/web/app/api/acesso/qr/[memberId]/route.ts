/**
 * GET /api/acesso/qr/[memberId] — Sprint 08 Faixa C.
 *
 * Retorna QR token rotativo do member (60s window). UI do member faz
 * polling cada 30s pra renovar (Sprint 09+: SSE push sem polling).
 *
 * Auth: requireFullSession + member precisa pertencer ao tenant do user
 * (defesa contra cross-tenant exfiltration).
 */
import { db } from '@repo/db/client'
import { accessSecrets, members } from '@repo/db/schema'
import { generateAccessToken } from '@repo/security'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params
  const session = await requireFullSession(`/app/members/${memberId}/qr`)
  const tenantId = session.logifit.tenantId

  // Valida que member pertence ao tenant
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) {
    return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  // Secret ativo (1ª linha = mais recente)
  const [secret] = await db
    .select({ secret: accessSecrets.secret })
    .from(accessSecrets)
    .where(and(eq(accessSecrets.tenantId, tenantId), eq(accessSecrets.active, true)))
    .limit(1)

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'NO_ACTIVE_SECRET', message: 'Tenant sem access_secret ativo — cadastre uma catraca primeiro' },
      { status: 503 },
    )
  }

  const token = generateAccessToken(memberId, secret.secret)
  // Tempo até próximo refresh: window de 60s
  const nextRefreshMs = (60 - (Math.floor(Date.now() / 1000) % 60)) * 1000

  return NextResponse.json({
    token,
    nextRefreshMs,
    rotationSec: 60,
  })
}
