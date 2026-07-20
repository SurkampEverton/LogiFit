import { lookupCnpj } from '@repo/cnpj'
/**
 * GET /api/pessoas/cnpj/{cnpj} — endpoint REST pra UI consumir auto-fill.
 *
 * Usado pelo formulário `/app/pessoas/new` enquanto o operador digita:
 * dispara fetch quando documento atinge 14 dígitos.
 *
 * Mesma lógica que `lookupCnpjAction` (Server Action) mas exposto via
 * REST — Client Component prefere fetch nativo com debounce em vez de
 * Server Action que força form submit.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ cnpj: string }> }) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'sessão expirada' } },
      { status: 401 },
    )
  }

  const { cnpj } = await params
  const result = await lookupCnpj(cnpj)

  if (!result.ok) {
    const httpStatus =
      result.error.code === 'CNPJ_NOT_FOUND'
        ? 404
        : result.error.code === 'CNPJ_INVALID'
          ? 400
          : result.error.code === 'CNPJ_RATE_LIMITED'
            ? 429
            : 502
    return NextResponse.json({ ok: false, error: result.error }, { status: httpStatus })
  }

  return NextResponse.json({ ok: true, data: result.data, fromCache: result.fromCache })
}
