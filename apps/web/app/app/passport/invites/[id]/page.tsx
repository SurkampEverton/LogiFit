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
 *   - paginação do histórico de acessos (atual hard-cap 50)
 *
 * Sprint 02c.3 (atual): histórico de leituras cross-tenant via
 *   `patient_data_access_log` (regra 42). RLS permite leitura quando
 *   tenant atual é reader OU source (ver `0012_passport_rls.sql`); aqui
 *   filtramos por `source_tenant_id = sessão` (somos a fonte) +
 *   `passport_passport_id = link.passport_passport_id` (este paciente).
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
  passportPassportId: string
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

interface LinkEventRow {
  createdAt: string
  actorKind: 'professional' | 'patient' | 'system'
  actorName: string | null
  eventKind:
    | 'invite_sent'
    | 'invite_resent'
    | 'invite_cancelled'
    | 'link_accepted'
    | 'link_revoked'
    | 'module_added'
    | 'module_activated'
    | 'module_deactivated'
    | 'module_substituted'
    | 'data_levels_changed'
  payload: Record<string, unknown> | null
}

interface AccessLogRow {
  recordedAt: string
  readerTenantId: string
  readerTenantName: string | null
  readerUserId: string
  readerUserName: string | null
  moduleType: string
  category: string
  resourceType: string | null
  resourceId: string | null
  requestId: string
  ip: string | null
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

const EVENT_KIND_LABELS: Record<LinkEventRow['eventKind'], string> = {
  invite_sent: 'Convite enviado',
  invite_resent: 'Convite reenviado',
  invite_cancelled: 'Convite cancelado',
  link_accepted: 'Vínculo aceito',
  link_revoked: 'Vínculo revogado',
  module_added: 'Módulo solicitado',
  module_activated: 'Módulo ativado',
  module_deactivated: 'Módulo desativado',
  module_substituted: 'Módulo substituído',
  data_levels_changed: 'Níveis de dados ajustados',
}

const ACTOR_KIND_LABELS: Record<LinkEventRow['actorKind'], string> = {
  professional: 'Profissional',
  patient: 'Paciente',
  system: 'Sistema',
}

function formatEventDetail(ev: LinkEventRow): string | undefined {
  const p = ev.payload
  if (!p) return undefined
  // Módulo no payload → "academia", "fisioterapia" etc
  const moduleVal = typeof p.module === 'string' ? (MODULE_LABELS[p.module] ?? p.module) : null
  switch (ev.eventKind) {
    case 'invite_sent': {
      const path = typeof p.creationPath === 'string' ? p.creationPath : null
      const count = typeof p.moduleCount === 'number' ? p.moduleCount : null
      const pieces: string[] = []
      if (path) pieces.push(path === 'proactive' ? 'auto-cadastro' : 'invite reativo')
      if (count !== null) pieces.push(`${count} módulo(s)`)
      return pieces.length > 0 ? pieces.join(' · ') : undefined
    }
    case 'link_accepted': {
      const c = typeof p.acceptedCount === 'number' ? p.acceptedCount : null
      return c !== null ? `${c} módulo(s) aceito(s)` : undefined
    }
    case 'invite_cancelled':
    case 'link_revoked': {
      const reason = typeof p.reason === 'string' ? p.reason : null
      return reason ?? undefined
    }
    case 'module_added':
    case 'module_activated':
    case 'module_deactivated':
    case 'module_substituted':
    case 'data_levels_changed':
      return moduleVal ?? undefined
    default:
      return undefined
  }
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
  let accessLog: AccessLogRow[] = []
  let linkEvents: LinkEventRow[] = []
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
         l.passport_passport_id AS "passportPassportId",
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

    // Histórico de leituras cross-tenant (regra 42): traz acessos onde
    // NOSSO tenant foi a fonte (`source_tenant_id = $1`) deste paciente
    // específico (`passport_passport_id = $2`). RLS permite leitura quando
    // tenant atual é reader OU source (ver `0012_passport_rls.sql`).
    //
    // Hard-cap 50 — paginação dedicada Sprint 02d+ se virar problema.
    // JOINs em tenants/users são best-effort (RLS pode bloquear tenant
    // externo → name NULL, mostramos uuid truncado na UI).
    if (invite) {
      const logRes = await client.query<AccessLogRow>(
        `SELECT
           pdal.recorded_at AS "recordedAt",
           pdal.reader_tenant_id AS "readerTenantId",
           reader_t.name AS "readerTenantName",
           pdal.reader_user_id AS "readerUserId",
           reader_p.name AS "readerUserName",
           pdal.module_type::text AS "moduleType",
           pdal.category,
           pdal.resource_type AS "resourceType",
           pdal.resource_id AS "resourceId",
           pdal.request_id AS "requestId",
           pdal.ip
         FROM patient_data_access_log pdal
         LEFT JOIN tenants reader_t ON reader_t.id = pdal.reader_tenant_id
         LEFT JOIN users reader_u ON reader_u.id = pdal.reader_user_id
         LEFT JOIN persons reader_p ON reader_p.id = reader_u.person_id
         WHERE pdal.source_tenant_id = $1
           AND pdal.passport_passport_id = $2
         ORDER BY pdal.recorded_at DESC
         LIMIT 50`,
        [session.logifit.tenantId, invite.passportPassportId],
      )
      accessLog = logRes.rows

      // Sprint 02c.4: timeline via patient_link_events particionada.
      // Hard-cap 100 — vínculo típico tem ~8 eventos, mas vínculo "old"
      // com várias mudanças de sharing pode acumular dezenas.
      // RLS filtra por tenant_id automaticamente (0061_patient_link_events_rls.sql).
      const evRes = await client.query<LinkEventRow>(
        `SELECT
           e.created_at AS "createdAt",
           e.actor_kind::text AS "actorKind",
           actor_p.name AS "actorName",
           e.event_kind::text AS "eventKind",
           e.payload
         FROM patient_link_events e
         LEFT JOIN users actor_u ON actor_u.id = e.actor_user_id
         LEFT JOIN persons actor_p ON actor_p.id = actor_u.person_id
         WHERE e.link_id = $1
         ORDER BY e.created_at ASC
         LIMIT 100`,
        [invite.id],
      )
      linkEvents = evRes.rows
    }
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

  // Sprint 02c.4: prefere patient_link_events; cai pra timeline derivada de
  // timestamps quando vínculo é anterior à migration 0049 (sem eventos).
  const timeline = buildTimeline(invite)
  const useEvents = linkEvents.length > 0

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
        <h2 className="text-lg font-medium">
          Linha do tempo{' '}
          {useEvents && (
            <span className="text-xs font-normal" style={{ color: 'var(--ev-text-muted)' }}>
              ({linkEvents.length} evento(s))
            </span>
          )}
        </h2>
        {!useEvents && (
          <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
            Vínculo anterior à Sprint 02c.4 — linha do tempo derivada dos timestamps do registro.
            Eventos novos a partir desta data são gravados em
            <code style={{ marginLeft: '0.25rem', fontFamily: 'var(--ev-mono, ui-monospace)' }}>
              patient_link_events
            </code>
            .
          </p>
        )}
        <ol
          className="space-y-3 rounded-md border p-4"
          style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
        >
          {useEvents
            ? linkEvents.map((ev, idx) => {
                const detail = formatEventDetail(ev)
                const actorLabel =
                  ev.actorName ??
                  (ev.actorKind === 'patient'
                    ? 'paciente'
                    : ev.actorKind === 'system'
                      ? 'sistema'
                      : 'profissional')
                return (
                  <li
                    key={`${ev.createdAt}-${idx}`}
                    className="flex flex-wrap items-baseline gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                    style={{ borderColor: 'var(--ev-border)' }}
                  >
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: 'var(--ev-text-muted)', minWidth: '140px' }}
                    >
                      {formatDateTime(ev.createdAt)}
                    </span>
                    <span className="text-sm">{EVENT_KIND_LABELS[ev.eventKind]}</span>
                    {detail && (
                      <span className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
                        — {detail}
                      </span>
                    )}
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px]"
                      style={{ background: 'var(--ev-bg)', color: 'var(--ev-text-muted)' }}
                      title={`Ator: ${ACTOR_KIND_LABELS[ev.actorKind]}`}
                    >
                      {actorLabel}
                    </span>
                  </li>
                )
              })
            : timeline.map((ev, idx) => (
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

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Histórico de acessos cross-tenant ({accessLog.length})
        </h2>
        <p className="text-xs" style={{ color: 'var(--ev-text-muted)' }}>
          Todas as leituras feitas por outros tenants sobre este paciente (regra 42 +{' '}
          <a
            href="/docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md"
            className="underline"
          >
            ADR 0077
          </a>
          ). Append-only, retenção 5 anos. Limite 50 entradas mais recentes.
        </p>
        {accessLog.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm"
            style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
          >
            Nenhum acesso cross-tenant registrado.
          </p>
        ) : (
          <div
            className="overflow-x-auto rounded-md border"
            style={{ borderColor: 'var(--ev-border)', background: 'var(--ev-surface)' }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--ev-border)', color: 'var(--ev-text-muted)' }}
                >
                  <th className="px-3 py-2 font-medium">Data/hora</th>
                  <th className="px-3 py-2 font-medium">Tenant leitor</th>
                  <th className="px-3 py-2 font-medium">Usuário</th>
                  <th className="px-3 py-2 font-medium">Módulo · Categoria</th>
                  <th className="px-3 py-2 font-medium">Recurso</th>
                  <th className="px-3 py-2 font-medium">request_id</th>
                </tr>
              </thead>
              <tbody>
                {accessLog.map((ev) => (
                  <tr
                    key={ev.requestId + ev.recordedAt}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--ev-border)' }}
                  >
                    <td className="px-3 py-2 tabular-nums">{formatDateTime(ev.recordedAt)}</td>
                    <td className="px-3 py-2">
                      {ev.readerTenantName ?? (
                        <span style={{ color: 'var(--ev-text-muted)' }}>
                          {ev.readerTenantId.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {ev.readerUserName ?? (
                        <span style={{ color: 'var(--ev-text-muted)' }}>
                          {ev.readerUserId.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {MODULE_LABELS[ev.moduleType] ?? ev.moduleType}
                      {' · '}
                      <span style={{ color: 'var(--ev-text-muted)' }}>{ev.category}</span>
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--ev-text-muted)' }}>
                      {ev.resourceType ? (
                        <>
                          {ev.resourceType}
                          {ev.resourceId && (
                            <span style={{ fontFamily: 'var(--ev-mono, ui-monospace)' }}>
                              {' '}
                              ({ev.resourceId.slice(0, 8)}…)
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      className="px-3 py-2"
                      style={{
                        color: 'var(--ev-text-muted)',
                        fontFamily: 'var(--ev-mono, ui-monospace)',
                      }}
                    >
                      {ev.requestId.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
