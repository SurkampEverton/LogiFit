import { NextResponse } from 'next/server'
import { z } from 'zod'
/**
 * POST /api/ai/chat — Sprint 06 Faixa C (ADR 0064 + ADR 0075).
 *
 * Endpoint REST simples (não-SSE no MVP — Sprint 06+ Faixa C real adiciona
 * streaming Vercel AI SDK).
 *
 * Body:
 *   { sessionId, message }
 *
 * Pipeline:
 *   1. requireFullSession() — checa auth
 *   2. delega ao Server Action `sendMessage` (que faz cota/classifier/audit)
 *   3. retorna { assistantMessage, guardrailBlocked, persona, quota }
 *
 * Por que ter API Route além do Server Action?
 *   - Server Actions são RSC-bound; futuras integrações externas (Coach PWA,
 *     teste E2E Playwright via API) precisam de endpoint REST estável.
 *   - SSE streaming exige API Route (não cabe em Server Action).
 */
import { sendMessage } from '../../../app/assistente/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000),
})

export async function POST(request: Request) {
  let parsed: z.infer<typeof BodySchema>
  try {
    const json = await request.json()
    parsed = BodySchema.parse(json)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Body inválido' } },
      { status: 400 },
    )
  }

  const result = await sendMessage(parsed)
  if (!result.ok) {
    const status =
      result.error.code === 'AI_QUOTA_EXCEEDED'
        ? 402
        : result.error.code === 'FORBIDDEN'
          ? 403
          : result.error.code === 'NOT_FOUND'
            ? 404
            : result.error.code === 'RATE_LIMITED'
              ? 429
              : 500
    return NextResponse.json(result, { status })
  }
  return NextResponse.json(result)
}
