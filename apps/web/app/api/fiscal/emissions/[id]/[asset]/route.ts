import { classifyFiscalAsset } from '@repo/ai'
/**
 * GET /api/fiscal/emissions/{id}/{pdf|xml} — download de DANFE/XML (Sprint 36b.5).
 *
 * Proxy autenticado: sessão staff + permission `fiscal.read`; o arquivo é
 * buscado no host Focus com o Basic auth do tenant (safeFetch — regra 37) e
 * streamado com Content-Disposition. Emissões mock não têm arquivo (404).
 */
import { db } from '@repo/db/client'
import { fiscalEmissions } from '@repo/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { downloadFiscalFile } from '../../../../../lib/fiscal-provider'
import { hasPermission } from '../../../../../lib/permissions'
import { getServerSession } from '../../../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ASSET_META = {
  pdf: { column: 'pdfStoragePath', contentType: 'application/pdf', ext: 'pdf' },
  xml: { column: 'xmlStoragePath', contentType: 'application/xml', ext: 'xml' },
} as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; asset: string }> },
) {
  const session = await getServerSession()
  if (!session?.logifit) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'sessão expirada' } },
      { status: 401 },
    )
  }
  if (!(await hasPermission(session.logifit.userId, 'fiscal.read'))) {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Sem permissão (fiscal.read)' } },
      { status: 403 },
    )
  }

  const { id, asset } = await params
  if (asset !== 'pdf' && asset !== 'xml') {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'asset deve ser pdf ou xml' } },
      { status: 400 },
    )
  }
  const meta = ASSET_META[asset]

  const [em] = await db
    .select({
      id: fiscalEmissions.id,
      chave: fiscalEmissions.chave,
      kind: fiscalEmissions.kind,
      pdfStoragePath: fiscalEmissions.pdfStoragePath,
      xmlStoragePath: fiscalEmissions.xmlStoragePath,
    })
    .from(fiscalEmissions)
    .where(and(eq(fiscalEmissions.id, id), eq(fiscalEmissions.tenantId, session.logifit.tenantId)))
    .limit(1)
  if (!em) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'Emissão não encontrada' } },
      { status: 404 },
    )
  }

  const path = asset === 'pdf' ? em.pdfStoragePath : em.xmlStoragePath
  if (!path) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Arquivo ainda não disponível — aguarde o processamento do provider',
        },
      },
      { status: 404 },
    )
  }

  // Link do portal do municipio: nao ha arquivo pra proxyar, e a pagina exige
  // a sessao do contribuinte. Devolver a URL e mais util que um 404 generico.
  if (classifyFiscalAsset(path) === 'external-portal') {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'EXTERNAL_ONLY',
          message:
            'Este município não entrega arquivo — a nota é consultada no portal da prefeitura',
          details: { url: path },
        },
      },
      { status: 409 },
    )
  }

  let upstream: Response | null
  try {
    upstream = await downloadFiscalFile(session.logifit.tenantId, path)
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'PROVIDER_DOWN', message: 'Provider fiscal indisponível' } },
      { status: 502 },
    )
  }
  if (!upstream) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Arquivo indisponível para esta emissão no provider',
        },
      },
      { status: 404 },
    )
  }
  if (!upstream.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'PROVIDER_DOWN', message: `Provider retornou ${upstream.status}` },
      },
      { status: 502 },
    )
  }

  const filename = `${em.kind}-${em.chave ?? em.id}.${meta.ext}`
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': meta.contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, max-age=600', // TTL 10min (sprint doc)
    },
  })
}
