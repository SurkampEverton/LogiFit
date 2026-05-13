/**
 * POST /api/ai/proposals/[id]/reject — Sprint 06 Faixa C (ADR 0075).
 */
import { rejectProposal } from '../../../../../app/assistente/actions'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await rejectProposal({ proposalId: id })
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 500
    return NextResponse.json(result, { status })
  }
  return NextResponse.json(result)
}
