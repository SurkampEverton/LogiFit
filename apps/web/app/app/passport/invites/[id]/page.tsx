/**
 * `/app/passport/invites/[id]` — detalhe do invite/vínculo cross-tenant (Sprint 02c+).
 *
 * Drill-down da lista `/invites`: traz tudo que existe sobre 1 link específico:
 *   - identidade do paciente (nome, email, telefone, doc)
 *   - quem emitiu o invite + quando + como (reactive/proactive)
 *   - módulos solicitados, com responsável técnico, data levels liberados
 *     e timestamps de ativação/desativação
 *   - timeline cronológica derivada dos timestamps (`created_at` /
 *     `invited_at` / `accepted_at` / `module.created_at` /
 *     `module.activated_at` / `module.deactivated_at` / `revoked_at`)
 *   - ações inline: cancelar (pending), revogar (active), copiar link,
 *     compartilhar WhatsApp — reusa `InviteRowActions` da lista
 *
 * Sprint 02c+ restante:
 *   - schema de eventos dedicado (`patient_link_events`) substitui timeline
 *     derivada dos timestamps + cobre histórico de canais de notificação
 *     (email enviado / WhatsApp dispatched / etc — hoje só Sprint 02b8
 *     persiste em log estruturado)
 *   - histórico de leituras cross-tenant via `patient_data_access_log`
 *     (regra 42) — quem leu, o quê, quando
 *
 * **RLS:** `set_config app.tenant_id` antes de SELECT + filtro explícito
 * `WHERE l.tenant_id = $1` (defesa em profundidade).
 */
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { buildInviteUrl, buildPatientWhatsappShareUrl } from '../../../../lib/passport-invite-share'
import { requireFullSession } from '../../../../lib/session'
import { InviteRowActions } from '../invite-row-actions'

export const dynamic = 'force-dynamic'

interface ModuleDetail {
  id: string
  module: string
  status: 'active' | 'inactive' | 'pending'
  responsibleName: string | null
  responsibleCouncil: string | null
  dataLevels: Record<string, boolean> | null
  createdAt: string
  activatedAt: string | null
  deactivatedAt: string | null
  deactivatedReason: string | null
}

interface InviteDetail {
  id: string
  status: 'pending' | 'active' | 'revoked'
  creationPath: 'reactive' | 'proactive'
  createdAt: string
  invitedAt: string | null
  acceptedAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  patientName: string
  patientEmail: string | null
  patientPhone: string | null
  patientDocument: string | null
  invitedByName: string | null
  modules: ModuleDetail[]
}

const MODULE_LABELS: Record<string, string> = {
  academia: '🏋️ Academia',
  personal_training: '🤸 Personal Training',
  fisioterapia: '🩺 Fisioterapia',
  nutricao: '🥗 Nutrição',
  pilates: '🧘 Pilates',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  pending: 'Pendente',
  revoked: 'Revogado',
  inactive: 'Inativo',
}

const DATA_LEVEL_LABELS: Record<string, string> = {
  identidade: 'Identidade',
  antropometria: 'Antropometria',
  treino: 'Treino',
  clinico: 'Clínico',
  workspace: 'Workspace',
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
    case 'inactive':
      return {
        background: 'var(--ev-danger-bg, #fee2e2)',
        color: 'var(--ev-danger-fg, #991b1b)',
      }
    default:
      return { background: 'var(--ev-surface)', color: 'var(--ev-text)' }
  }
}

function formatDateTime(date: string | null): string {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface TimelineEvent {
  at: string
  kind:
    | 'created'
    | 'invited'
    | 'accepted'
    | 'module_created'
    | 'module_activated'
    | 'module_deactivated'
    | 'revoked'
  label: string
  detail?: string
}

function buildTimeline(invite: InviteDetail): TimelineEvent[] {
  const events: TimelineEvent[] = []
  events.push({
    at: invite.createdAt,
    kind: 'created',
    label: 'Vínculo criado',
    detail: invite.invitedByName
      ? `por ${invite.invitedByName} (${invite.creationPath === 'proactive' ? 'auto-cadastro' : 'invite reativo'})`
      : invite.creationPath === 'proactive'
        ? 'auto-cadastro do paciente'
        : 'invite reativo',
  })
  if (invite.invitedAt && invite.invitedAt !== invite.createdAt) {
    events.push({ at: invite.invitedAt, kind: 'invited', label: 'Convite enviado' })
  }
  if (invite.acceptedAt) {
    events.push({ at: invite.acceptedAt, kind: 'accepted', label: 'Aceito pelo paciente' })
  }
  for (const m of invite.modules) {
    events.push({
      at: m.createdAt,
      kind: 'module_created',
      label: `Módulo solicitado: ${MODULE_LABELS[m.module] ?? m.module}`,
      detail: m.responsibleName ? `responsável: ${m.responsibleName}` : undefined,
    })
    if (m.activatedAt && m.activatedAt !== m.createdAt) {
      events.push({
        at: m.activatedAt,
        kind: 'module_activated',
        label: `Módulo ativado: ${MODULE_LABELS[m.module] ?? m.module}`,
      })
    }
    if (m.deactivatedAt) {
      events.push({
        at: m.deactivatedAt,
        kind: 'module_deactivated',
        label: `Módulo desativado: ${MODULE_LABELS[m.module] ?? m.module}`,
        detail: m.deactivatedReason ?? undefined,
      })
    }
  }
  if (invite.revokedAt) {
    events.push({
      at: invite.revokedAt,
      kind: 'revoked',
      label: 'Vínculo revogado',
      detail: invite.revokedReason ?? undefined,
    })
  }
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

export default async function PassportInviteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await requireFullSession(`/app/passport/invites/${id}`)

  // Valida formato UUID localmente pra evitar SQL com payload arbitrário
  // (pg ainda valida, mas falhar cedo dá 404 limpo).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound()
  }

  const client = await pool.connect()
  let invite: InviteDetail | null = null
  let tenantName = 'sua clínica'
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [session.logifit.tenantId])

    const tRes = await client.query<{ name: string }>(
      'SELECT name FROM tenants WHERE id = $1 LIMIT 1',
      [session.logifit.tenantId],
    )
    if (tRes.rows[0]?.name) tenantName = tRes.rows[0].name

    const linkRes = await client.query<InviteDetail>(
      `SELECT
         l.id,
         l.status::text AS status,
         l.creation_path AS "creationPath",
         l.created_at AS "createdAt",
         l.invited_at AS "invitedAt",
         l.accepted_at AS "acceptedAt",
         l.revoked_at AS "revokedAt",
         l.revoked_reason AS "revokedReason",
         p.name AS "patientName",
         p.email AS "patientEmail",
         p.phone AS "patientPhone",
         p.document AS "patientDocument",
         inviter_p.name AS "invitedByName",
         COALESCE(
           json_agg(
             json_build_object(
               'id', m.id,
               'module', m.module::text,
               'status', m.status::text,
               'responsibleName', resp_p.name,
               'responsibleCouncil',
                 CASE WHEN reg.id IS NOT NULL
                   THEN reg.council_body || '/' || reg.council_state || ' ' || reg.council_number
                   ELSE NULL
                 END,
               'dataLevels', m.data_levels,
               'createdAt', m.created_at,
               'activatedAt', m.activated_at,
               'deactivatedAt', m.deactivated_at,
               'deactivatedReason', m.deactivated_reason
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
       LEFT JOIN professional_registrations reg ON reg.id = m.responsible_registration_id
       WHERE l.id = $1 AND l.tenant_id = $2
       GROUP BY l.id, p.id, inviter_p.id
       LIMIT 1`,
      [id, session.logifit.tenantId],
    )
    invite = linkRes.rows[0] ?? null
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  if (!invite) notFound()

  const inviteUrl = buildInviteUrl(invite.id)
  const whatsappShareUrl =
    invite.status === 'pending' && invite.patientPhone
      ? buildPatientWhatsappShareUrl({
          patientPhone: invite.patientPhone,
          patientName: invite.patientName,
          tenantName,
          modules: invite.modules.map((m) => m.module),
          inviteUrl,
        })
      : null

  const timeline = buildTimeline(invite)

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
      <header className="space-y-3">
        <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          <Link href="/app" style={{ color: 'inherit' }}>
            Início
          </Link>
          {' / '}
          <Link href="/app/passport" style={{ color: 'inherit' }}>
            Passaporte
          </Link>
          {' / '}
          <Link href="/app/passport/invites" style={{ color: 'inherit' }}>
            Convites
          </Link>
          {' / '}
          <span>Detalhe</span>
        </nav>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{invite.patientName}</h1>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={statusBadgeStyle(invite.status)}
          >
            {STATUS_LABELS[invite.status] ?? invite.status}
          </span>
          {invite.creationPath === 'proactive' && (
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: 'var(--ev-bg)', color: 'var(--ev-text-muted)' }}
              title="Paciente se cadastrou sozinho (Path B)"
            >
              auto-cadastro
            </span>
          )}
        </div>
        {invite.status !== 'revoked' && (
          <InviteRowActions
            inviteId={invite.id}
            status={invite.status}
            inviteUrl={inviteUrl}
            whatsappShareUrl={whatsappShareUrl}
            patientName={invite.patientName}
          />
        )}
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Contato</h2>
        <dl
          className="grid grid-cols-1 gap-3 rounded-md border p-4 sm:grid-cols-3"
          style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
        >
          <Field label="Email" value={invite.patientEmail} />
          <Field label="Telefone" value={invite.patientPhone} />
          <Field label="Documento" value={invite.patientDocument} mono />
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Módulos solicitados ({invite.modules.length})</h2>
        {invite.modules.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm"
            style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
          >
            Nenhum módulo associado a este vínculo.
          </p>
        ) : (
          <ul className="space-y-3">
            {invite.modules.map((m) => (
              <li
                key={m.id}
                className="rounded-md border p-4 space-y-2"
                style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{MODULE_LABELS[m.module] ?? m.module}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={statusBadgeStyle(m.status)}
                  >
                    {STATUS_LABELS[m.status] ?? m.status}
                  </span>
                </div>
                <div
                  className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"
                  style={{ color: 'var(--ev-text-muted)' }}
                >
                  <div>
                    <strong style={{ color: 'var(--ev-text)' }}>Responsável:</strong>{' '}
                    {m.responsibleName ?? <em>nenhum</em>}
                    {m.responsibleCouncil && <span> · {m.responsibleCouncil}</span>}
                  </div>
                  <div>
                    <strong style={{ color: 'var(--ev-text)' }}>Solicitado:</strong>{' '}
                    {formatDateTime(m.createdAt)}
                  </div>
                  {m.activatedAt && (
                    <div>
                      <strong style={{ color: 'var(--ev-text)' }}>Ativado:</strong>{' '}
                      {formatDateTime(m.activatedAt)}
                    </div>
                  )}
                  {m.deactivatedAt && (
                    <div>
                      <strong style={{ color: 'var(--ev-text)' }}>Desativado:</strong>{' '}
                      {formatDateTime(m.deactivatedAt)}
                      {m.deactivatedReason && <span> — {m.deactivatedReason}</span>}
                    </div>
                  )}
                </div>
                {m.dataLevels && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(m.dataLevels)
                      .filter(([, v]) => v === true)
                      .map(([k]) => (
                        <span
                          key={k}
                          className="rounded-full px-2 py-0.5 text-xs"
                          style={{ background: 'var(--ev-bg)', color: 'var(--ev-text)' }}
                        >
                          {DATA_LEVEL_LABELS[k] ?? k}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Linha do tempo</h2>
        <ol
          className="space-y-3 rounded-md border p-4"
          style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
        >
          {timeline.map((ev, idx) => (
            <li
              key={`${ev.at}-${idx}`}
              className="flex flex-wrap items-baseline gap-2 border-b pb-2 last:border-b-0 last:pb-0"
              style={{ borderColor: 'var(--ev-border)' }}
            >
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--ev-text-muted)', minWidth: '140px' }}
              >
                {formatDateTime(ev.at)}
              </span>
              <span className="text-sm">{ev.label}</span>
              {ev.detail && (
                <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                  — {ev.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

interface FieldProps {
  label: string
  value: string | null
  mono?: boolean
}

function Field({ label, value, mono }: FieldProps) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide" style={{ color: 'var(--ev-text-muted)' }}>
        {label}
      </dt>
      <dd
        className="text-sm"
        style={{
          color: value ? 'var(--ev-text)' : 'var(--ev-text-muted)',
          fontFamily: mono ? 'var(--ev-mono, ui-monospace)' : undefined,
        }}
      >
        {value ?? '—'}
      </dd>
    </div>
  )
}
