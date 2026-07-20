/**
 * POST /api/mobile/auth/check-version — Sprint 35 Faixa B.
 *
 * Endpoint PÚBLICO (sem auth). App chama em boot pra saber se precisa
 * atualizar. Body: { platform, currentVersion }. Retorna se há update
 * obrigatório (min_required) ou opcional.
 *
 * Sprint 35b: rate limit por IP (regra 36) pra prevenir abuso.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { checkAppVersion } from '../../../../meu/mobile/actions'

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
    const result = await checkAppVersion(body)
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro inesperado'
    const code = (e as { code?: string }).code ?? 'INTERNAL_ERROR'
    const status = code === 'VALIDATION_ERROR' ? 400 : 500
    return NextResponse.json({ ok: false, error: { code, message } }, { status })
  }
}
