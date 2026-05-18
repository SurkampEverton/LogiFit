/**
 * POST /api/ai/genui — Sprint 28 Faixa C.
 *
 * Endpoint HTTP que devolve resposta Generative UI dado um prompt. Cliente JS
 * (ex: `/app/copilot/genui-demo`) pode chamar via fetch — o Server Action
 * `composeGenUIResponse` cobre o caso server-rendered.
 *
 * Sprint 28b: streaming SSE — modelo retorna tool calls progressivamente +
 * cliente renderiza conforme chega. MVP entrega resposta batch única.
 */
import { NextRequest, NextResponse } from 'next/server'
import { composeGenUIResponse } from '../../../app/copilot/genui-actions'

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
    const result = await composeGenUIResponse(body as Parameters<typeof composeGenUIResponse>[0])
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro inesperado'
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    )
  }
}
