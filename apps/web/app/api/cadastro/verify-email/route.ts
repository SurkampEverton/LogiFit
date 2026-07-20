/**
 * GET /api/cadastro/verify-email?t=<token> — Sprint 02b4 fechamento.
 *
 * Endpoint público (sem auth). Paciente clica link do email → este route
 * handler consome o token + marca `email_verified_at` + redireciona pra
 * tela amigável de confirmação (`/cadastro/email-confirmado`).
 *
 * Erros redirecionam pra `/cadastro/email-erro?reason=<código>` com
 * mensagem amigável (não expõe stack trace).
 *
 * Pode ser chamado múltiplas vezes — idempotente (cliques duplicados
 * em apps de email são comuns).
 */
import { type NextRequest, NextResponse } from 'next/server'
import { verifyPassportEmail } from '../../../cadastro/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t')
  if (!token) {
    return NextResponse.redirect(new URL('/cadastro/email-erro?reason=missing_token', req.url))
  }

  try {
    const result = await verifyPassportEmail({ token })
    if (!result.ok) {
      return NextResponse.redirect(new URL('/cadastro/email-erro?reason=invalid', req.url))
    }
    const params = result.alreadyVerified ? '?already=1' : ''
    return NextResponse.redirect(new URL(`/cadastro/email-confirmado${params}`, req.url))
  } catch (err) {
    // ApiException tem `code` próprio; mapear pra `reason` URL-safe
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code).toLowerCase()
        : 'internal_error'
    return NextResponse.redirect(
      new URL(`/cadastro/email-erro?reason=${encodeURIComponent(code)}`, req.url),
    )
  }
}
