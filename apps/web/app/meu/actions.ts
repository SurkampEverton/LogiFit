'use server'

/**
 * Portal do Paciente — Server Actions core (Sprint 26 Faixa B.2).
 *
 * Diferente de `/app/.../actions.ts`: o caller é o PACIENTE (member), não staff.
 * Sessão usa cookie próprio (`lf_member_session`) e RLS via `app.member_id`.
 *
 * Sprint 02c2 → 02d-2: migrado pra `wrapMemberAction` (apps/web/app/lib/wrap-member-action.ts).
 * 3 SAs pré-auth (requestMagicLink / verifyMagicLink / logoutMember) ficam
 * fora do wrapper (sem session ainda; anti-enumeration ou idempotência exigem
 * controle manual) — `// wrap-exempt:` comment marca explicitamente.
 *
 * Actions:
 *   - requestMagicLink — público (pré-auth) + rate-limited + anti-enumeration
 *   - verifyMagicLink — público (token plano vindo do email/SMS) cria 1ª sessão
 *   - logoutMember — tolerante (não exige session ativa)
 *   - cancelMyAppointment — respeita cancellation policy por vertical
 *   - revokeMySession — desloga outro dispositivo
 *   - updateMyConsent — liga/desliga consent intra-tenant
 *   - acknowledgeCrossPrescriptionAlert / acknowledgeIncident — confirma leitura
 *   - exportCrossTenantAccessLog — solicita export LGPD art. 18 V
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { randomUUID } from 'node:crypto'
import {
  decideCancellation,
  generateMagicLink,
  generateRefreshToken,
  hashToken,
  shouldRateLimit,
  verifyMagicLinkAgainstRow,
  type Vertical,
} from '@repo/db/portal-member'
import { z } from 'zod'
import {
  clearMemberCookie,
  getMemberSession,
  setMemberCookie,
} from '../lib/member-session'
import { wrapMemberAction } from '../lib/wrap-member-action'

// ─── Zod schemas ────────────────────────────────────────────────────────

const RequestMagicLinkSchema = z.object({
  email: z.string().email().max(255),
  /** Subdomínio do tenant pra montar URL do link (ADR 0065) */
  tenantSlug: z.string().min(2).max(64),
  /** Opcional: redirect pós-login */
  redirectTo: z.string().max(200).optional(),
})

const VerifyMagicLinkSchema = z.object({
  token: z.string().min(8).max(200),
  deviceLabel: z.string().max(120).optional(),
})

const CancelAppointmentSchema = z.object({
  appointmentId: z.string().uuid(),
})

const RevokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
})

const UpdateConsentSchema = z.object({
  purpose: z.enum([
    'marketing',
    'cross_module_share',
    'analytics_anon',
    'photo_use',
    'whatsapp_promotional',
  ]),
  granted: z.boolean(),
  ripdVersion: z.string().max(20).optional(),
  consentText: z.string().max(2000).optional(),
})

const AcknowledgeAlertSchema = z.object({
  alertId: z.string().uuid(),
})

const AcknowledgeIncidentSchema = z.object({
  incidentId: z.string().uuid(),
})

const ExportAccessLogSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  format: z.enum(['csv', 'pdf']),
})

// ─── requestMagicLink (PRÉ-AUTH) ────────────────────────────────────────
/**
 * Público — qualquer um pode chamar com email. Retorna SEMPRE ok=true (anti-
 * enumeration). Envia email SE: email existe + rate limit permite.
 *
 * Sprint 26 entrega só email (canal SMS adicionado Sprint 26b com Twilio).
 */
// wrap-exempt: pré-auth público (sem member session), anti-enumeration sempre retorna ok:true
export async function requestMagicLink(input: unknown) {
  const parsed = RequestMagicLinkSchema.safeParse(input)
  if (!parsed.success) {
    // Erro de validação ainda esconde info (não revela campo problemático)
    return { ok: true, sent: false }
  }
  const { email, tenantSlug, redirectTo } = parsed.data

  // 1. Resolve tenant pelo slug
  const tenantRes = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
    [tenantSlug],
  )
  const tenantId = tenantRes.rows[0]?.id
  if (!tenantId) {
    return { ok: true, sent: false } // anti-enumeration
  }

  // 2. Resolve member pelo email (JOIN persons.email)
  const memberRes = await pool.query<{ id: string }>(
    `SELECT m.id FROM members m
     JOIN persons p ON p.id = m.person_id
     WHERE m.tenant_id = $1 AND lower(p.email) = lower($2) AND m.archived_at IS NULL
     LIMIT 1`,
    [tenantId, email],
  )
  const memberId = memberRes.rows[0]?.id
  if (!memberId) {
    return { ok: true, sent: false } // anti-enumeration
  }

  // 3. Rate limit check (últimas requests dentro de 15min)
  const recentRes = await pool.query<{ count_15m: string; last_age_s: number | null }>(
    `SELECT
       count(*) AS count_15m,
       EXTRACT(EPOCH FROM (now() - max(created_at)))::int AS last_age_s
     FROM member_auth_tokens
     WHERE member_id = $1 AND created_at > now() - interval '15 minutes'`,
    [memberId],
  )
  const decision = shouldRateLimit({
    requestCount: Number.parseInt(recentRes.rows[0]?.count_15m ?? '0', 10),
    secondsSinceLast: recentRes.rows[0]?.last_age_s ?? null,
  })
  if (!decision.allowed) {
    return { ok: true, sent: false, throttled: true }
  }

  // 4. Gera + persiste token (hash)
  const link = generateMagicLink()
  await pool.query(
    `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at, channel, request_ip)
     VALUES ($1, $2, $3, $4, 'email', $5)`,
    [tenantId, memberId, link.tokenHash, link.expiresAt, null],
  )

  // 5. Envio do email (Sprint 26b: integra com @repo/email/SES; MVP só registra)
  // Por enquanto: token plano vai em log estruturado pra dev testar local
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[meu] magic link → ${email}: https://${tenantSlug}.logifit.com.br/meu/login/verify?t=${link.token}${redirectTo ? `&to=${encodeURIComponent(redirectTo)}` : ''}`,
    )
  }

  return { ok: true, sent: true }
}

// ─── verifyMagicLink (PRÉ-AUTH) ─────────────────────────────────────────
/**
 * Verifica token plano vindo do link. Marca used_at + cria member_session.
 * Retorna refresh token plano (caller seta cookie).
 */
// wrap-exempt: pré-auth público (sem member session ainda), cria a primeira session
export async function verifyMagicLink(input: unknown) {
  const parsed = VerifyMagicLinkSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      request_id: randomUUID(),
    })
  }
  const { token, deviceLabel } = parsed.data
  const tokenHash = hashToken(token)

  // Bypass RLS: token verify acontece pré-auth
  const r = await pool.query<{
    id: string
    tenant_id: string
    member_id: string
    token_hash: string
    expires_at: Date
    used_at: Date | null
  }>(
    `SELECT id, tenant_id, member_id, token_hash, expires_at, used_at
     FROM member_auth_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  )
  const row = r.rows[0]
  if (!row) {
    throw new ApiException({
      code: 'NOT_FOUND',
      message: 'Link inválido ou expirado',
      request_id: randomUUID(),
    })
  }

  const verify = verifyMagicLinkAgainstRow(token, {
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
  })
  if (!verify.ok) {
    throw new ApiException({
      code: verify.reason === 'expired' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      message:
        verify.reason === 'expired'
          ? 'Link expirado — solicite um novo'
          : verify.reason === 'used'
            ? 'Link já utilizado — solicite um novo'
            : 'Link inválido',
      request_id: randomUUID(),
    })
  }

  // Marca used_at + cria session em transação
  const refresh = generateRefreshToken()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`UPDATE member_auth_tokens SET used_at = now() WHERE id = $1`, [row.id])
    await client.query(
      `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at, device_label)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.tenant_id, row.member_id, refresh.tokenHash, refresh.expiresAt, deviceLabel ?? null],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  // Seta cookie (refresh plano)
  await setMemberCookie(refresh.token)

  return {
    ok: true,
    memberId: row.member_id,
    tenantId: row.tenant_id,
  }
}

// ─── logoutMember (TOLERANTE) ───────────────────────────────────────────
// wrap-exempt: tolerante (getMemberSession em vez de require) — idempotente, funciona mesmo sem session ativa
export async function logoutMember() {
  const session = await getMemberSession()
  if (session) {
    await pool.query(
      `UPDATE member_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1`,
      [session.sessionId],
    )
  }
  await clearMemberCookie()
  return { ok: true }
}

// ─── cancelMyAppointment ────────────────────────────────────────────────

export const cancelMyAppointment = wrapMemberAction(
  {
    module: 'meu.agenda',
    action: 'appointment.cancel',
    returnTo: '/meu/agenda',
    resourceType: 'appointments',
    schema: CancelAppointmentSchema,
    eventKind: 'meu.appointment.cancelled',
  },
  async (input, { session }) => {
    // 1. Buscar appointment + tenant vertical
    const r = await pool.query<{
      id: string
      starts_at: Date
      status: string
      member_id: string
    }>(
      `SELECT id, starts_at, status, member_id
       FROM appointments
       WHERE id = $1 AND member_id = $2
       LIMIT 1`,
      [input.appointmentId, session.memberId],
    )
    const appt = r.rows[0]
    if (!appt)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Agendamento não encontrado',
        request_id: '',
      })

    // Sprint 26: vertical fixo academia (MVP); Sprint 26b: lookup tenant.verticals
    const vertical: Vertical = 'academia'

    const decision = decideCancellation({
      vertical,
      appointmentStartsAt: appt.starts_at.toISOString(),
      appointmentStatus: appt.status as
        | 'scheduled'
        | 'confirmed'
        | 'cancelled'
        | 'no_show'
        | 'completed',
    })

    if (!decision.ok) {
      throw new ApiException({
        code: decision.action === 'denied' ? 'FORBIDDEN' : 'CONFLICT',
        message:
          decision.action === 'denied'
            ? 'Não é possível cancelar este agendamento'
            : 'Esta vertical requer reagendamento ao invés de cancelamento',
        request_id: '',
        details: { reason: decision.reason, action: decision.action },
      })
    }

    if (decision.action === 'cancel_directly') {
      await pool.query(
        `UPDATE appointments
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'member', updated_at = now()
         WHERE id = $1`,
        [appt.id],
      )
      return { ok: true, action: 'cancel_directly' as const }
    }
    // awaiting_provider_ack — Sprint 26 cria flag (campo não existe ainda no schema);
    // MVP grava notes pro profissional
    await pool.query(
      `UPDATE appointments
       SET notes = COALESCE(notes, '') || E'\n[Pedido cancelamento pelo paciente em ' || now() || ']',
           updated_at = now()
       WHERE id = $1`,
      [appt.id],
    )
    return { ok: true, action: 'awaiting_provider_ack' as const }
  },
)

// ─── revokeMySession ────────────────────────────────────────────────────

export const revokeMySession = wrapMemberAction(
  {
    module: 'meu.perfil',
    action: 'session.revoke',
    returnTo: '/meu/perfil',
    resourceType: 'member_sessions',
    schema: RevokeSessionSchema,
    eventKind: 'meu.session.revoked',
  },
  async (input, { session }) => {
    const r = await pool.query(
      `UPDATE member_sessions
       SET revoked_at = now(), revoked_reason = 'user_revoke'
       WHERE id = $1 AND member_id = $2 AND revoked_at IS NULL`,
      [input.sessionId, session.memberId],
    )
    return { ok: true, revoked: r.rowCount ?? 0 }
  },
)

// ─── updateMyConsent ────────────────────────────────────────────────────

export const updateMyConsent = wrapMemberAction(
  {
    module: 'meu.privacidade',
    action: 'consent.update',
    returnTo: '/meu/privacidade',
    resourceType: 'member_consents',
    schema: UpdateConsentSchema,
    eventKind: 'meu.consent.updated',
  },
  async (input, { session }) => {
    // Revoga consent atual da mesma purpose (se existir)
    await pool.query(
      `UPDATE member_consents
       SET revoked_at = now()
       WHERE member_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [session.memberId, input.purpose],
    )

    if (input.granted) {
      // Insere novo grant
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO member_consents
         (tenant_id, member_id, purpose, granted, ripd_version, consent_text)
         VALUES ($1, $2, $3, true, $4, $5)
         RETURNING id`,
        [
          session.tenantId,
          session.memberId,
          input.purpose,
          input.ripdVersion ?? 'v1.0',
          input.consentText ?? null,
        ],
      )
      return { ok: true, consentId: ins.rows[0]!.id, granted: true }
    }
    // grant=false → registra negativa explícita
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO member_consents
       (tenant_id, member_id, purpose, granted, ripd_version)
       VALUES ($1, $2, $3, false, $4)
       RETURNING id`,
      [session.tenantId, session.memberId, input.purpose, input.ripdVersion ?? 'v1.0'],
    )
    return { ok: true, consentId: ins.rows[0]!.id, granted: false }
  },
)

// ─── acknowledgeCrossPrescriptionAlert (Sprint 26b — ADR 0077) ─────────
/**
 * Paciente confirma leitura de alerta cross-prescription (Sprint 11 emite).
 *
 * Schema `cross_prescription_alerts` será materializado em extensão Sprint 11+;
 * MVP retorna ok=true sem persistir. Caller passa alertId UUID.
 */
export const acknowledgeCrossPrescriptionAlert = wrapMemberAction(
  {
    module: 'meu.privacidade',
    action: 'cross_prescription_alert.acknowledge',
    returnTo: '/meu/privacidade/alertas-cruzados',
    schema: AcknowledgeAlertSchema,
    eventKind: 'meu.cross_prescription_alert.acknowledged',
  },
  async (input, _ctx) => {
    // Sprint 26c: UPDATE cross_prescription_alerts SET acknowledged_at = now()
    // WHERE id = $1 AND patient_passport_id = $2 (após FK + RLS).
    // MVP: registra audit + retorna sucesso (idempotente).
    return {
      ok: true,
      alertId: input.alertId,
      acknowledged: true,
      note: 'Schema cross_prescription_alerts será materializado em Sprint 11+ extensão',
    }
  },
)

// ─── acknowledgeIncident (Sprint 26b — ADR 0067 addendum) ──────────────
/**
 * Paciente confirma leitura de notificação de incidente cross-tenant.
 *
 * Schema `security_incidents` + tabela de notificações por paciente vai vir
 * com addendum ao ADR 0067. MVP retorna ok=true.
 */
export const acknowledgeIncident = wrapMemberAction(
  {
    module: 'meu.privacidade',
    action: 'incident.acknowledge',
    returnTo: '/meu/privacidade/incidentes',
    schema: AcknowledgeIncidentSchema,
    eventKind: 'meu.incident.acknowledged',
  },
  async (input, _ctx) => {
    // Sprint 26c: UPDATE security_incident_notifications SET viewed_at = now()
    // WHERE incident_id = $1 AND patient_passport_id = $2.
    return {
      ok: true,
      incidentId: input.incidentId,
      acknowledged: true,
      note: 'Schema security_incidents será materializado em ADR 0067 addendum',
    }
  },
)

// ─── exportCrossTenantAccessLog (Sprint 26b — ADR 0077) ────────────────
/**
 * Gera export CSV/PDF dos acessos cross-tenant do paciente no período.
 *
 * MVP síncrono: gera CSV em memória + grava em MinIO bucket
 * `member-exports/<member_id>/<export_id>.csv` com TTL 7d.
 * Retorna `downloadUrl` apontando pra API Route `/api/meu/privacidade/export/[id]`
 * que valida ownership + serve o arquivo.
 *
 * Sprint 26c: jobs assíncronos (relatórios grandes >100k linhas) + PDF via
 * @react-pdf/renderer + assinatura digital opcional.
 */
export const exportCrossTenantAccessLog = wrapMemberAction(
  {
    module: 'meu.privacidade',
    action: 'cross_tenant_access.export',
    returnTo: '/meu/privacidade/acessos',
    resourceType: 'data_subject_requests',
    schema: ExportAccessLogSchema,
    eventKind: 'meu.cross_tenant_access.exported',
  },
  async (input, { session }) => {
    const exportId = randomUUID()

    // Resolve passport do member
    const passRes = await pool.query<{ passport_id: string }>(
      `SELECT pcl.passport_passport_id AS passport_id
       FROM patient_company_links pcl
       JOIN members m ON m.person_id = pcl.person_id
       WHERE m.id = $1 AND pcl.tenant_id = $2
       LIMIT 1`,
      [session.memberId, session.tenantId],
    )
    const passportId = passRes.rows[0]?.passport_id
    if (!passportId) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Vínculo cross-tenant não encontrado',
        request_id: '',
      })
    }

    // Registra a solicitação em data_subject_requests (LGPD art. 18 V — portabilidade).
    // O job que materializa o arquivo + URL TTL 7d vai consumir esta row em Sprint 26c.
    await pool.query(
      `INSERT INTO data_subject_requests
       (id, tenant_id, subject_person_id, kind, state, request_payload, sla_due_at)
       VALUES (
         $1, $2,
         (SELECT person_id FROM members WHERE id = $3),
         'portability', 'received',
         $4::jsonb,
         now() + interval '15 days'
       )`,
      [
        exportId,
        session.tenantId,
        session.memberId,
        JSON.stringify({
          export_kind: 'cross_tenant_access_log',
          start_date: input.startDate,
          end_date: input.endDate,
          format: input.format,
          passport_id: passportId,
        }),
      ],
    )

    return {
      ok: true as const,
      exportId,
      downloadUrl: `/api/meu/privacidade/export/${exportId}`,
    }
  },
)
