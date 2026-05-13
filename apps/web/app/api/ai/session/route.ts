/**
 * POST /api/ai/session — cria nova sessão do assistente (ADR 0075).
 * Delega ao Server Action `newSession`.
 */
import { newSession } from '../../../app/assistente/actions'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  let body: { memberId?: string; contextPath?: string; personaOverride?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    /* body opcional */
  }
  const result = await newSession({
    memberId: body.memberId as string | undefined,
    contextPath: body.contextPath,
    personaOverride: body.personaOverride as
      | 'member'
      | 'professional_clinical'
      | 'professional_coach'
      | 'admin'
      | 'recepcao'
      | 'super_admin'
      | 'contador_externo'
      | 'dpo'
      | undefined,
  })
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json(result)
}
