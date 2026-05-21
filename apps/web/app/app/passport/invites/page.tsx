/**
 * `/app/passport/invites` — lista de invites cross-tenant emitidos pelo tenant (Sprint 02b9+).
 *
 * Completa o loop UX: staff cria invite em `/new` → vê aqui o que foi criado,
 * status atual (pending/active/revoked), módulos solicitados, profissional
 * responsável, há quanto tempo foi enviado. Ações inline:
 *   - `pending`: Copiar link · WhatsApp share · Cancelar convite (ConfirmDialog)
 *   - `active`:  Revogar vínculo (PromptDialog pra motivo)
 *
 * Filtros via querystring:
 *   - `?status=pending|active|revoked` (default `all`)
 *   - `?module=academia|personal_training|fisioterapia|nutricao|pilates`
 *   - `?q=<nome>` busca por nome do paciente (ILIKE substring, mín. 1 char,
 *     máx. 80, metachars `%` e `_` strip-ados pra evitar wildcard injection)
 *
 * Sprint 02c+ restante:
 *   - paginação cursor-based (atual hard-cap 100)
 *   - filtro por profissional responsável (autocomplete cross-module)
 *   - drill-down pra detalhe do invite com timeline de eventos
 *
 * **RLS:** `set_config app.tenant_id` antes de SELECT; defesa em profundidade
 * com `WHERE l.tenant_id = $1` explícito.
 */
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { buildInviteUrl, buildPatientWhatsappShareUrl } from '../../../lib/passport-invite-share'
import { requireFullSession } from '../../../lib/session'
import { InviteRowActions } from './invite-row-actions'

export const dynamic = 'force-dynamic'

interface InviteModule {
  module: string
  status: string
  responsibleName: string | null
}

interface InviteRow {
  id: string
  status: 'pending' | 'active' | 'revoked'
  creationPath: 'reactive' | 'proactive'
  invitedAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  patientName: string
  patientEmail: string | null
  patientPhone: string | null
  invitedByName: string | null
  modules: InviteModule[]
}

const STATUS_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'active', label: 'Ativos' },
  { key: 'revoked', label: 'Revogados' },
] as const

const MODULE_LABELS: Record<string, string> = {
  academia: '🏋️ Academia',
  personal_training: '🤸 Personal',
  fisioterapia: '🩺 Fisioterapia',
  nutricao: '🥗 Nutrição',
  pilates: '🧘 Pilates',
}

const MODULE_KEYS = [
  'academia',
  'personal_training',
  'fisioterapia',
  'nutricao',
  'pilates',
] as const
type ModuleKey = (typeof MODULE_KEYS)[number]

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  pending: 'Pendente',
  revoked: 'Revogado',
}

function statusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case 'active':
      return {
        background: 'var(--ev-success-bg, #d1fae5)',
        color: 'var(--ev-success-fg, #065f46)',
      }
    case 'pending':
      return {
        background: 'var(--ev-warning-bg, #fef3c7)',
        color: 'var(--ev-warning-fg, #92400e)',
      }
    case 'revoked':
      return {
        background: 'var(--ev-danger-bg, #fee2e2)',
        color: 'var(--ev-danger-fg, #991b1b)',
      }
    default:
      return {
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
      }
  }
}

function buildFilterUrl(parts: {
  status?: 'pending' | 'active' | 'revoked' | 'all'
  module?: ModuleKey | 'all'
  q?: string
}): string {
  const sp = new URLSearchParams()
  if (parts.status && parts.status !== 'all') sp.set('status', parts.status)
  if (parts.module && parts.module !== 'all') sp.set('module', parts.module)
  if (parts.q) sp.set('q', parts.q)
  const qs = sp.toString()
  return qs ? `/app/passport/invites?${qs}` : '/app/passport/invites'
}

function formatRelative(date: string | null): string {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return d.toLocaleDateString('pt-BR')
  if (days === 0) return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 7) return `há ${days}d`
  if (days < 30) return `há ${Math.floor(days / 7)}sem`
  if (days < 365) return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  return d.toLocaleDateString('pt-BR')
}

export default async function PassportInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; module?: string; q?: string }>
}) {
  const session = await requireFullSession('/app/passport/invites')
  const params = await searchParams
  const statusFilter = (['pending', 'active', 'revoked'] as const).includes(
    (params.status ?? 'all') as 'pending' | 'active' | 'revoked',
  )
    ? (params.status as 'pending' | 'active' | 'revoked')
    : 'all'
  const moduleFilter: ModuleKey | 'all' = (MODULE_KEYS as readonly string[]).includes(
    params.module ?? '',
  )
    ? (params.module as ModuleKey)
    : 'all'
  const qRaw = (params.q ?? '').trim()
  // Limita pra evitar abuso (ilike com %% em string longa é caro) e remove
  // metachars do ilike (% e _) — busca literal por substring no nome.
  const qFilter = qRaw.length > 0 && qRaw.length <= 80 ? qRaw.replace(/[%_]/g, '') : ''

  const client = await pool.connect()
  let rows: InviteRow[] = []
  let tenantName = 'sua clínica'
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [session.logifit.tenantId])

    const tRes = await client.query<{ name: string }>(
      'SELECT name FROM tenants WHERE id = $1 LIMIT 1',
      [session.logifit.tenantId],
    )
    if (tRes.rows[0]?.name) tenantName = tRes.rows[0].name

    const res = await client.query<InviteRow>(
      `SELECT
         l.id,
         l.status::text AS status,
         l.creation_path AS "creationPath",
         l.invited_at AS "invitedAt",
         l.accepted_at AS "acceptedAt",
         l.revoked_at AS "revokedAt",
         l.revoked_reason AS "revokedReason",
         p.name AS "patientName",
         p.email AS "patientEmail",
         p.phone AS "patientPhone",
         inviter_p.name AS "invitedByName",
         COALESCE(
           json_agg(
             json_build_object(
               'module', m.module::text,
               'status', m.status::text,
               'responsibleName', resp_p.name
             ) ORDER BY m.created_at
           ) FILTER (WHERE m.id IS NOT NULL),
           '[]'::json
         ) AS modules
       FROM patient_company_links l
       INNER JOIN persons p ON p.id = l.person_id
       LEFT JOIN users inviter_u ON inviter_u.id = l.invited_by_user_id
       LEFT JOIN persons inviter_p ON inviter_p.id = inviter_u.person_id
       LEFT JOIN patient_link_modules m ON m.link_id = l.id
       LEFT JOIN users resp_u ON resp_u.id = m.responsible_professional_user_id
       LEFT JOIN persons resp_p ON resp_p.id = resp_u.person_id
       WHERE l.tenant_id = $1
         AND ($2::text = 'all' OR l.status::text = $2)
         AND ($3::text = '' OR p.name ILIKE '%' || $3 || '%')
         AND ($4::text = 'all' OR EXISTS (
           SELECT 1 FROM patient_link_modules mf
           WHERE mf.link_id = l.id AND mf.module::text = $4
         ))
       GROUP BY l.id, p.id, inviter_p.id
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [session.logifit.tenantId, statusFilter, qFilter, moduleFilter],
    )
    rows = res.rows
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  const totalByStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
            <Link href="/app" style={{ color: 'inherit' }}>
              Início
            </Link>
            {' / '}
            <Link href="/app/passport" style={{ color: 'inherit' }}>
              Passaporte
            </Link>
            {' / '}
            <span>Convites</span>
          </nav>
          <h1 className="text-3xl font-semibold tracking-tight">Convites cross-tenant</h1>
          <p className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
            Vínculos de paciente entre clínica/academia e outros tenants — todos os convites criados
            por este tenant (
            <Link
              href="/app/passport/invites/new"
              className="font-medium hover:underline"
              style={{ color: 'var(--ev-primary)' }}
            >
              criar novo →
            </Link>
            ).
          </p>
        </div>
        <Link
          href="/app/passport/invites/new"
          className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
          style={{
            background: 'var(--ev-primary)',
            color: 'var(--ev-primary-foreground, white)',
            minHeight: 'var(--ev-touch-min, 44px)',
          }}
        >
          + Novo convite
        </Link>
      </header>

      <form
        method="GET"
        action="/app/passport/invites"
        className="flex flex-wrap items-end gap-3"
        aria-label="Buscar e filtrar convites"
      >
        {/* Preserva status atual ao submeter — `?status=` já vem dos pills abaixo */}
        {statusFilter !== 'all' && <input type="hidden" name="status" value={statusFilter} />}
        <div className="flex-1 min-w-[200px] space-y-1">
          <label
            htmlFor="filter-q"
            className="block text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--ev-text-muted)' }}
          >
            Buscar paciente
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={qFilter}
            placeholder="Nome ou parte do nome"
            maxLength={80}
            className="block w-full rounded-md border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--ev-border)',
              background: 'var(--ev-input-bg, var(--ev-surface))',
              color: 'var(--ev-text)',
              minHeight: 'var(--ev-touch-min, 44px)',
            }}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="filter-module"
            className="block text-xs font-medium uppercase tracking-wide"
            style={{ color: 'var(--ev-text-muted)' }}
          >
            Módulo
          </label>
          <select
            id="filter-module"
            name="module"
            defaultValue={moduleFilter}
            className="rounded-md border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--ev-border)',
              background: 'var(--ev-input-bg, var(--ev-surface))',
              color: 'var(--ev-text)',
              minHeight: 'var(--ev-touch-min, 44px)',
            }}
          >
            <option value="all">Todos</option>
            {MODULE_KEYS.map((k) => (
              <option key={k} value={k}>
                {MODULE_LABELS[k] ?? k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium"
            style={{
              background: 'var(--ev-primary)',
              color: 'var(--ev-primary-foreground, white)',
              minHeight: 'var(--ev-touch-min, 44px)',
            }}
          >
            Filtrar
          </button>
          {(qFilter || moduleFilter !== 'all') && (
            <Link
              href={buildFilterUrl({ status: statusFilter })}
              className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
              style={{
                borderColor: 'var(--ev-border)',
                background: 'var(--ev-surface)',
                color: 'var(--ev-text)',
                minHeight: 'var(--ev-touch-min, 44px)',
              }}
            >
              Limpar
            </Link>
          )}
        </div>
      </form>

      <nav className="flex flex-wrap gap-2" aria-label="Filtrar convites por status">
        {STATUS_FILTERS.map((f) => {
          const isActive = statusFilter === f.key
          const count = f.key === 'all' ? rows.length : (totalByStatus[f.key] ?? 0)
          return (
            <Link
              key={f.key}
              href={buildFilterUrl({
                status: f.key as 'pending' | 'active' | 'revoked' | 'all',
                module: moduleFilter,
                q: qFilter,
              })}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium"
              style={{
                borderColor: isActive ? 'var(--ev-primary)' : 'var(--ev-border)',
                background: isActive ? 'var(--ev-primary)' : 'var(--ev-surface)',
                color: isActive ? 'var(--ev-primary-foreground, white)' : 'var(--ev-text)',
                minHeight: 'var(--ev-touch-min, 44px)',
              }}
              aria-pressed={isActive}
            >
              {f.label}
              {count > 0 && (
                <span
                  className="rounded-full px-1.5 text-xs"
                  style={{
                    background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--ev-bg)',
                  }}
                >
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed p-8 text-center text-sm"
          style={{
            borderColor: 'var(--ev-border)',
            color: 'var(--ev-text-muted)',
          }}
        >
          {qFilter || moduleFilter !== 'all'
            ? 'Nenhum convite encontrado com os filtros aplicados. '
            : statusFilter === 'all'
              ? 'Nenhum convite criado ainda. '
              : `Nenhum convite ${STATUS_LABELS[statusFilter]?.toLowerCase() ?? statusFilter}. `}
          <Link
            href="/app/passport/invites/new"
            className="font-medium hover:underline"
            style={{ color: 'var(--ev-primary)' }}
          >
            Criar primeiro convite →
          </Link>
        </div>
      ) : (
        <ul
          className="divide-y rounded-md border"
          style={{
            borderColor: 'var(--ev-border)',
            background: 'var(--ev-surface)',
          }}
        >
          {rows.map((r) => {
            const inviteUrl = buildInviteUrl(r.id)
            const whatsappShareUrl =
              r.status === 'pending' && r.patientPhone
                ? buildPatientWhatsappShareUrl({
                    patientPhone: r.patientPhone,
                    patientName: r.patientName,
                    tenantName,
                    modules: r.modules.map((m) => m.module),
                    inviteUrl,
                  })
                : null
            return (
              <li key={r.id} className="px-4 py-4 space-y-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-base">{r.patientName}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={statusBadgeStyle(r.status)}
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  {r.creationPath === 'proactive' && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: 'var(--ev-bg)',
                        color: 'var(--ev-text-muted)',
                      }}
                      title="Paciente se cadastrou sozinho (Path B)"
                    >
                      auto-cadastro
                    </span>
                  )}
                </div>

                {(r.patientEmail || r.patientPhone) && (
                  <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                    {r.patientEmail && <span>{r.patientEmail}</span>}
                    {r.patientEmail && r.patientPhone && <span> · </span>}
                    {r.patientPhone && <span>{r.patientPhone}</span>}
                  </p>
                )}

                {r.modules.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.modules.map((m, idx) => (
                      <span
                        key={`${r.id}-${m.module}-${idx}`}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                        style={{
                          background: 'var(--ev-bg)',
                          color: 'var(--ev-text)',
                        }}
                        title={
                          m.responsibleName
                            ? `Responsável: ${m.responsibleName}`
                            : 'Sem responsável definido'
                        }
                      >
                        {MODULE_LABELS[m.module] ?? m.module}
                        {m.responsibleName && (
                          <span style={{ color: 'var(--ev-text-muted)' }}>
                            · {m.responsibleName}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                  {r.status === 'pending' && r.invitedAt && (
                    <>Convidado {formatRelative(r.invitedAt)}</>
                  )}
                  {r.status === 'active' && r.acceptedAt && (
                    <>Aceito {formatRelative(r.acceptedAt)}</>
                  )}
                  {r.status === 'revoked' && r.revokedAt && (
                    <>
                      Revogado {formatRelative(r.revokedAt)}
                      {r.revokedReason ? ` — ${r.revokedReason}` : ''}
                    </>
                  )}
                  {r.invitedByName && (
                    <span>
                      {' · '}por {r.invitedByName}
                    </span>
                  )}
                </p>

                {r.status !== 'revoked' && (
                  <InviteRowActions
                    inviteId={r.id}
                    status={r.status}
                    inviteUrl={inviteUrl}
                    whatsappShareUrl={whatsappShareUrl}
                    patientName={r.patientName}
                    compact
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
