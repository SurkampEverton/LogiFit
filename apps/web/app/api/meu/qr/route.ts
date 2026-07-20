import { pool } from '@repo/db/client'
import { encodeQrString, generateQrPayload } from '@repo/db/portal-member'
/**
 * GET /api/meu/qr — Sprint 26 Faixa C (26b).
 *
 * Retorna QR payload atual do paciente autenticado. Cliente JS chama a cada 60s
 * pra renovar visual (sem recarregar a página).
 *
 * Auth via cookie member (httpOnly path=/meu — mas Next.js libera pra `/api/meu/*`
 * porque o path do cookie é hierárquico... validamos via getMemberSession).
 */
import { NextResponse } from 'next/server'
import { getMemberSession, withMemberContext } from '../../../lib/member-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getMemberSession()
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Login expirado' } },
      { status: 401 },
    )
  }

  const secret = await withMemberContext(session, async () => {
    const r = await pool.query<{ secret: string }>(
      `SELECT secret FROM access_secrets
       WHERE tenant_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [session.tenantId],
    )
    return r.rows[0]?.secret ?? null
  })

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'Estabelecimento sem QR configurado' } },
      { status: 404 },
    )
  }

  const payload = generateQrPayload({
    memberId: session.memberId,
    tenantId: session.tenantId,
    secret,
  })
  const qr = encodeQrString(payload)

  return NextResponse.json({ ok: true, qr, window: payload.window }, { status: 200 })
}
