/**
 * GET /api/meu/perfil/email/confirm-change?t=<token> — Sprint 02b5.
 *
 * Paciente clica link recebido no NOVO email → este route handler consome
 * o token + UPDATE identity.email + notifica email ANTIGO + redireciona pra
 * tela amigável.
 *
 * Pré-auth (paciente pode estar deslogado ou usando outro device).
 *
 * Erros redirecionam pra `/cadastro/email-erro?reason=<código>` (reusa
 * mesma página de erro do email confirmation — UX consistente).
 */
import { NextRequest, NextResponse } from 'next/server'
import { confirmPassportEmailChange } from '../../../../../meu/perfil/passport-actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t')
  if (!token) {
    return NextResponse.redirect(
      new URL('/cadastro/email-erro?reason=missing_token', req.url),
    )
  }

  try {
    const result = await confirmPassportEmailChange({ token })
    if (!result.ok) {
      return NextResponse.redirect(
        new URL('/cadastro/email-erro?reason=invalid', req.url),
      )
    }
    return NextResponse.redirect(
      new URL('/meu/perfil/email-trocado', req.url),
    )
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code).toLowerCase()
        : 'internal_error'
    return NextResponse.redirect(
      new URL(`/cadastro/email-erro?reason=${encodeURIComponent(code)}`, req.url),
    )
  }
}
