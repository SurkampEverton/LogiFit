/**
 * POST /api/meu/verify — Sprint 26 Faixa C (26b).
 *
 * Consome token plano + cria session. Útil quando paciente clica magic link
 * via app nativo / browser que abre direto a API (Sprint 26c: deeplink universal).
 * Pra navegação web normal, a página `/meu/login/verify` Server Component já
 * faz isso direto via Server Action.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicLink } from '../../../meu/actions'

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
    const result = await verifyMagicLink(body)
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro inesperado'
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    )
  }
}
