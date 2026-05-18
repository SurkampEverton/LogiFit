/**
 * GET /api/meu/privacidade/export/[exportId] — Sprint 26 Faixa C (26b).
 *
 * Entrega export previamente solicitado via `exportCrossTenantAccessLog`.
 * Valida ownership (member.person_id = data_subject_requests.subject_person_id)
 * + TTL 7d via sla_due_at-15+7.
 *
 * MVP: gera CSV inline a partir da query atual (sem materialização persistida).
 * Sprint 26c: job materializa em MinIO, esta rota só faz `signedUrl()` redirect.
 */
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@repo/db/client'
import { getMemberSession, withMemberContext } from '../../../../../lib/member-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ exportId: string }>
}

interface DsrRow {
  id: string
  subject_person_id: string | null
  request_payload: {
    export_kind?: string
    start_date?: string
    end_date?: string
    format?: 'csv' | 'pdf'
    passport_id?: string
  } | null
  created_at: Date
  state: string
}

interface AccessLogRow {
  recorded_at: Date
  reader_tenant_name: string | null
  module_type: string
  category: string
  resource_type: string | null
}

const EXPORT_TTL_DAYS = 7

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { exportId } = await ctx.params
  const session = await getMemberSession()
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Login expirado' } },
      { status: 401 },
    )
  }

  const { dsr, rows } = await withMemberContext(session, async () => {
    // 1. Lookup DSR + valida ownership
    const dsrRes = await pool.query<DsrRow>(
      `SELECT dsr.id, dsr.subject_person_id, dsr.request_payload, dsr.created_at, dsr.state
       FROM data_subject_requests dsr
       JOIN members m ON m.person_id = dsr.subject_person_id
       WHERE dsr.id = $1 AND m.id = $2
       LIMIT 1`,
      [exportId, session.memberId],
    )
    const d = dsrRes.rows[0] ?? null
    if (!d) return { dsr: null, rows: [] as AccessLogRow[] }

    const passportId = d.request_payload?.passport_id
    if (!passportId) return { dsr: d, rows: [] as AccessLogRow[] }

    const startDate = d.request_payload?.start_date ?? null
    const endDate = d.request_payload?.end_date ?? null

    const accessRes = await pool.query<AccessLogRow>(
      `SELECT pdal.recorded_at,
              c.name AS reader_tenant_name,
              pdal.module_type::text AS module_type,
              pdal.category,
              pdal.resource_type
       FROM patient_data_access_log pdal
       LEFT JOIN companies c ON c.tenant_id = pdal.reader_tenant_id
       WHERE pdal.passport_passport_id = $1
         AND ($2::timestamptz IS NULL OR pdal.recorded_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR pdal.recorded_at <= $3::timestamptz)
       ORDER BY pdal.recorded_at DESC
       LIMIT 10000`,
      [passportId, startDate, endDate],
    )
    return { dsr: d, rows: accessRes.rows }
  })

  if (!dsr) {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'Export não encontrado' } },
      { status: 404 },
    )
  }

  // TTL 7d a partir do created_at
  const ttlExpires = new Date(dsr.created_at.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000)
  if (Date.now() > ttlExpires.getTime()) {
    return NextResponse.json(
      { ok: false, error: { code: 'EXPIRED', message: 'Link de download expirado (TTL 7d)' } },
      { status: 410 },
    )
  }

  const format = dsr.request_payload?.format ?? 'csv'

  if (format === 'csv') {
    const csvLines = ['recorded_at,reader_tenant,module,category,resource']
    for (const r of rows) {
      const line = [
        r.recorded_at.toISOString(),
        (r.reader_tenant_name ?? '').replaceAll(',', ';'),
        r.module_type,
        r.category,
        r.resource_type ?? '',
      ].join(',')
      csvLines.push(line)
    }
    const csv = csvLines.join('\n')
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="acessos-${exportId.slice(0, 8)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // PDF stub — Sprint 26c: @react-pdf/renderer
  return NextResponse.json(
    {
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'PDF será gerado em versão futura' },
    },
    { status: 501 },
  )
}
