/**
 * Smoke test endpoint pro GlitchTip integration — Sprint 00 Faixa 3 follow-up.
 *
 * **NÃO É ROTA DE PRODUÇÃO PERMANENTE.** Existe só pra validar que a
 * pipeline `app → @sentry/nextjs → GlitchTip self-host` está funcional.
 * Remover após smoke test confirmado em painel `errors.logifit.com.br`.
 *
 * Cenários disparados (1 request = 3 eventos):
 *   1. `captureMessage` (info) — testa transport client-friendly
 *   2. `captureException` (error) — testa server SDK + scope tags
 *   3. throw `Error` no fim — testa o capture-hook do @repo/errors via
 *      wrapApiHandler (`setCaptureHook` plugado em sentry.server.config.ts)
 *
 * Uso:
 *   curl https://app.logifit.com.br/api/smoke-test/sentry?token=<SMOKE_TOKEN>
 *
 * Path NÃO usa underscore (`_smoke`) porque Next.js App Router trata pastas
 * com underscore inicial como private folders (excluídas do routing).
 *
 * `SMOKE_TOKEN` env evita scan público encher GlitchTip de eventos lixo.
 */
import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const expectedToken = process.env.SMOKE_TOKEN
  const providedToken = url.searchParams.get('token')

  if (!expectedToken) {
    return NextResponse.json(
      {
        ok: false,
        error: 'SMOKE_TOKEN env var não configurada — endpoint inativo',
      },
      { status: 503 },
    )
  }
  if (providedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: 'token inválido' }, { status: 403 })
  }

  const traceId = crypto.randomUUID()

  // 1. captureMessage (info-level)
  Sentry.withScope((scope) => {
    scope.setLevel('info')
    scope.setTag('smoke_test', 'true')
    scope.setTag('trace_id', traceId)
    Sentry.captureMessage(`GlitchTip smoke test (info) — ${traceId}`)
  })

  // 2. captureException (error-level) com Error sintético
  Sentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('smoke_test', 'true')
    scope.setTag('trace_id', traceId)
    scope.setExtra('source', '/api/_smoke/sentry route handler')
    Sentry.captureException(new Error(`GlitchTip smoke test (captured) — ${traceId}`))
  })

  // 3. Force flush antes de retornar (em ambientes serverless o processo morre)
  await Sentry.flush(5000)

  return NextResponse.json({
    ok: true,
    traceId,
    instructions: [
      'Abra https://errors.logifit.com.br e verifique 2 eventos novos:',
      '  - Info: "GlitchTip smoke test (info)"',
      '  - Error: "GlitchTip smoke test (captured)"',
      `Ambos devem ter tag trace_id=${traceId}.`,
      'Se aparecer, integração server-side funcional. Remover este endpoint.',
    ],
  })
}
