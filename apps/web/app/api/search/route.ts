/**
 * GET /api/search?q=... — pesquisa global (ADR 0062 fase 1, regra 30).
 *
 * Consulta `search_index` (alimentado por triggers das tabelas-fonte) com
 * full-text português + trigram fuzzy (typo em nome) + substring. Resultados
 * com `required_permission` são filtrados via `has_permission()` — recepção
 * nunca vê o que não pode abrir.
 *
 * Consumidor: `<CommandPalette>` (debounce 200ms, query >= 2 chars).
 */
import { pool } from '@repo/db/client'
import { NextResponse } from 'next/server'
import { hasPermissions } from '../../lib/permissions'
import { getServerSession } from '../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface SearchRow {
  kind: string
  label: string
  subtitle: string | null
  url: string
  required_permission: string | null
  is_sensitive: boolean
  rank: number
}

export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session?.logifit) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'sessão expirada' } },
      { status: 401 },
    )
  }

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  if (q.length < 2) {
    return NextResponse.json({ ok: true, data: { results: [] } })
  }

  const { rows } = await pool.query<SearchRow>(
    `SELECT kind, label, subtitle, url, required_permission, is_sensitive,
            GREATEST(
              ts_rank(search_vector, websearch_to_tsquery('portuguese', $2)),
              similarity(searchable_text, $2)
            ) AS rank
     FROM search_index
     WHERE tenant_id = $1
       AND (
         search_vector @@ websearch_to_tsquery('portuguese', $2)
         OR searchable_text ILIKE '%' || $2 || '%'
         OR similarity(searchable_text, $2) > 0.15
       )
     ORDER BY rank DESC
     LIMIT 30`,
    [session.logifit.tenantId, q],
  )

  // Gate de permission (ADR 0062): checa cada permission distinta uma vez
  const neededPermissions = [
    ...new Set(rows.map((r) => r.required_permission).filter((p): p is string => p !== null)),
  ]
  const granted =
    neededPermissions.length > 0
      ? await hasPermissions(session.logifit.userId, neededPermissions)
      : {}

  const results = rows
    .filter((r) => r.required_permission === null || granted[r.required_permission])
    .slice(0, 15)
    .map((r) => ({
      kind: r.kind,
      label: r.label,
      subtitle: r.subtitle,
      url: r.url,
      isSensitive: r.is_sensitive,
    }))

  return NextResponse.json({ ok: true, data: { results } })
}
