/**
 * POST /api/mobile/auth/register-push — Sprint 35 Faixa B.
 *
 * App nativo (Sprint 35b) chama com APNs/FCM token. Exige session member
 * (Bearer JWT) — Sprint 35b implementa middleware mobile auth distinto da web.
 *
 * MVP: usa Server Action `registerPushToken` que valida via cookie. Sprint 35b
 * substitui por header `Authorization: Bearer <token>` + lookup em
 * `mobile_sessions.refresh_token_hash`.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { registerPushToken } from '../../../../meu/mobile/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'JSON inválido' } },
      { status: 400 },
    )
  }
  try {
    // wrapMemberAction internamente valida com Zod (RegisterPushTokenSchema);
    // cast pra contornar a tipagem estrita da assinatura — input final é validado pelo schema
    const result = await registerPushToken(body as Parameters<typeof registerPushToken>[0])
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro inesperado'
    const code = (e as { code?: string }).code ?? 'INTERNAL_ERROR'
    const status = code === 'VALIDATION_ERROR' ? 400 : 500
    return NextResponse.json({ ok: false, error: { code, message } }, { status })
  }
}
