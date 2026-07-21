/**
 * POST /api/fiscal/focus-nfe/callback — webhook Focus NFe (Sprint 36b, ADR 0059).
 *
 * Focus dispara quando emissão muda de status (autorizado, erro_autorizacao,
 * cancelado, etc). A URL registrada no Focus inclui `?token={webhook_secret}`
 * do tenant — verificação timingSafeEqual contra o secret cifrado em
 * `fiscal_provider_credentials` (Focus não assina HMAC nativo; token na URL +
 * TLS + IP allowlist documentada no runbook cobrem o threat model).
 *
 * **Idempotente:** replay do mesmo payload converge pro mesmo estado final.
 * Out-of-order não faz downgrade: `completed` nunca volta pra `processing`,
 * `cancelled` é terminal.
 *
 * **Lookup:** `ref` (nosso providerRef determinístico) → fiscal_emissions via
 * unique index `fiscal_emissions_provider_ref_uq`. Multi-tenant: candidatos por
 * ref são filtrados pelo token — só o tenant cujo secret bate processa.
 */
import { db } from '@repo/db/client'
import { fiscalEmissions } from '@repo/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveWebhookSecret } from '../../../../lib/fiscal-provider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CallbackBodySchema = z.object({
  ref: z.string().min(1),
  status: z.string().min(1),
  chave_nfe: z.string().optional().nullable(),
  chave: z.string().optional().nullable(),
  codigo_verificacao: z.string().optional().nullable(),
  caminho_xml_nota_fiscal: z.string().optional().nullable(),
  caminho_danfe: z.string().optional().nullable(),
  mensagem_sefaz: z.string().optional().nullable(),
  mensagem: z.string().optional().nullable(),
})

type EmissionStatus = 'draft' | 'queued' | 'processing' | 'completed' | 'rejected' | 'cancelled'

function mapFocusStatus(focusStatus: string): EmissionStatus | null {
  switch (focusStatus) {
    case 'autorizado':
      return 'completed'
    case 'processando_autorizacao':
      return 'processing'
    case 'erro_autorizacao':
    case 'denegado':
      return 'rejected'
    case 'cancelado':
      return 'cancelled'
    default:
      return null
  }
}

/** Downgrade proibido — webhook out-of-order não regride estado final. */
function isDowngrade(current: EmissionStatus, next: EmissionStatus): boolean {
  if (current === 'cancelled') return true
  if (current === 'completed' && (next === 'processing' || next === 'queued')) {
    return true
  }
  return false
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'token ausente' } },
      { status: 401 },
    )
  }

  let body: z.infer<typeof CallbackBodySchema>
  try {
    body = CallbackBodySchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'payload inválido' } },
      { status: 400 },
    )
  }

  // Candidatos por ref (unique por tenant+provider — multi-tenant improvável
  // mas possível com refs determinísticas; token discrimina o dono)
  const candidates = await db
    .select({
      id: fiscalEmissions.id,
      tenantId: fiscalEmissions.tenantId,
      status: fiscalEmissions.status,
      chave: fiscalEmissions.chave,
    })
    .from(fiscalEmissions)
    .where(
      and(eq(fiscalEmissions.provider, 'focus_nfe'), eq(fiscalEmissions.providerRef, body.ref)),
    )
    .limit(5)

  let matched: (typeof candidates)[number] | null = null
  for (const candidate of candidates) {
    const secret = await resolveWebhookSecret(candidate.tenantId)
    if (secret && timingSafeEqualStr(secret, token)) {
      matched = candidate
      break
    }
  }

  if (!matched) {
    // 401 uniforme — não vaza se ref existe ou se token errou
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'ref/token inválidos' } },
      { status: 401 },
    )
  }

  const nextStatus = mapFocusStatus(body.status)
  if (!nextStatus) {
    // Status Focus desconhecido — aceita (200) sem processar pra não gerar retry storm
    return NextResponse.json({
      ok: true,
      data: { processed: false, reason: 'status desconhecido' },
    })
  }

  const currentStatus = matched.status as EmissionStatus
  if (isDowngrade(currentStatus, nextStatus)) {
    return NextResponse.json({
      ok: true,
      data: { processed: false, reason: 'out-of-order ignorado' },
    })
  }

  const chave = body.chave_nfe ?? body.chave ?? body.codigo_verificacao ?? matched.chave
  const rejectionReason =
    nextStatus === 'rejected' ? (body.mensagem_sefaz ?? body.mensagem ?? null) : null

  const alreadyFinal = currentStatus === nextStatus && matched.chave === chave
  if (alreadyFinal) {
    return NextResponse.json({ ok: true, data: { processed: false, reason: 'replay idempotente' } })
  }

  // tenant-scope-exempt: webhook do provedor; a emissao e resolvida por
  // provider_ref dentro do tenant cujo webhook secret validou (ver header).
  await db
    .update(fiscalEmissions)
    .set({
      status: nextStatus,
      chave,
      xmlStoragePath: body.caminho_xml_nota_fiscal ?? undefined,
      pdfStoragePath: body.caminho_danfe ?? undefined,
      rejectionReason,
      completedAt: nextStatus === 'completed' ? new Date() : undefined,
      cancelledAt: nextStatus === 'cancelled' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(fiscalEmissions.id, matched.id))

  return NextResponse.json({
    ok: true,
    data: { processed: true, emission_id: matched.id, status: nextStatus },
  })
}
