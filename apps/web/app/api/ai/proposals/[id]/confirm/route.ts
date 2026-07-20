import { NextResponse } from 'next/server'
/**
 * POST /api/ai/proposals/[id]/confirm — Sprint 06 Faixa C (ADR 0075).
 *
 * User clica Confirmar no `<ActionConfirmDialog>`. Valida estado + tenant + user
 * via Server Action `confirmProposal` (proteção dupla: só o autor confirma).
 */
import { confirmProposal } from '../../../../../app/assistente/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await confirmProposal({ proposalId: id })
  if (!result.ok) {
    const status =
      result.error.code === 'CONFLICT'
        ? 409
        : result.error.code === 'NOT_FOUND'
          ? 404
          : result.error.code === 'FORBIDDEN'
            ? 403
            : 500
    return NextResponse.json(result, { status })
  }
  return NextResponse.json(result)
}
