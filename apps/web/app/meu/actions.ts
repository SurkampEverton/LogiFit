'use server'

/**
 * Portal do Paciente — Server Actions (Sprint 26 Faixa B.2).
 *
 * Diferente de `/app/.../actions.ts`: o caller é o PACIENTE (member), não staff.
 * Sessão usa cookie próprio (`lf_member_session`) e RLS via `app.member_id`.
 *
 * Actions:
 *   - requestMagicLink — público (sem auth) + rate-limited + anti-enumeration
 *   - verifyMagicLink — público (token plano vindo do email/SMS)
 *   - logout — invalida sessão atual
 *   - cancelMyAppointment — respeita cancellation policy por vertical
 *   - revokeMySession — desloga outro dispositivo
 *   - updateMyConsent — liga/desliga consent intra-tenant
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
  requireMemberSession,
  setMemberCookie,
  withMemberContext,
} from '../lib/member-session'

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

// ─── requestMagicLink ───────────────────────────────────────────────────
/**
 * Público — qualquer um pode chamar com email. Retorna SEMPRE ok=true (anti-
 * enumeration). Envia email SE: email existe + rate limit permite.
 *
 * Sprint 26 entrega só email (canal SMS adicionado Sprint 26b com Twilio).
 */
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

// ─── verifyMagicLink ────────────────────────────────────────────────────
/**
 * Verifica token plano vindo do link. Marca used_at + cria member_session.
 * Retorna refresh token plano (caller seta cookie).
 */
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

// ─── logout ─────────────────────────────────────────────────────────────
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
export async function cancelMyAppointment(input: unknown) {
  const parsed = CancelAppointmentSchema.safeParse(input)
  if (!parsed.success)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      request_id: randomUUID(),
    })
  const session = await requireMemberSession('/meu/agenda')

  return withMemberContext(session, async () => {
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
      [parsed.data.appointmentId, session.memberId],
    )
    const appt = r.rows[0]
    if (!appt)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Agendamento não encontrado',
        request_id: randomUUID(),
      })

    // Sprint 26: vertical fixo academia (MVP); Sprint 26b: lookup tenant.verticals
    const vertical: Vertical = 'academia'

    const decision = decideCancellation({
      vertical,
      appointmentStartsAt: appt.starts_at.toISOString(),
      appointmentStatus: appt.status as 'scheduled' | 'confirmed' | 'cancelled' | 'no_show' | 'completed',
    })

    if (!decision.ok) {
      throw new ApiException({
        code: decision.action === 'denied' ? 'FORBIDDEN' : 'CONFLICT',
        message:
          decision.action === 'denied'
            ? 'Não é possível cancelar este agendamento'
            : 'Esta vertical requer reagendamento ao invés de cancelamento',
        request_id: randomUUID(),
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
  })
}

// ─── revokeMySession ────────────────────────────────────────────────────
export async function revokeMySession(input: unknown) {
  const parsed = RevokeSessionSchema.safeParse(input)
  if (!parsed.success)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      request_id: randomUUID(),
    })
  const session = await requireMemberSession('/meu/perfil')

  return withMemberContext(session, async () => {
    const r = await pool.query(
      `UPDATE member_sessions
       SET revoked_at = now(), revoked_reason = 'user_revoke'
       WHERE id = $1 AND member_id = $2 AND revoked_at IS NULL`,
      [parsed.data.sessionId, session.memberId],
    )
    return { ok: true, revoked: r.rowCount ?? 0 }
  })
}

// ─── updateMyConsent ────────────────────────────────────────────────────
export async function updateMyConsent(input: unknown) {
  const parsed = UpdateConsentSchema.safeParse(input)
  if (!parsed.success)
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos',
      request_id: randomUUID(),
    })
  const session = await requireMemberSession('/meu/privacidade')

  return withMemberContext(session, async () => {
    // Revoga consent atual da mesma purpose (se existir)
    await pool.query(
      `UPDATE member_consents
       SET revoked_at = now()
       WHERE member_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [session.memberId, parsed.data.purpose],
    )

    if (parsed.data.granted) {
      // Insere novo grant
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO member_consents
         (tenant_id, member_id, purpose, granted, ripd_version, consent_text)
         VALUES ($1, $2, $3, true, $4, $5)
         RETURNING id`,
        [
          session.tenantId,
          session.memberId,
          parsed.data.purpose,
          parsed.data.ripdVersion ?? 'v1.0',
          parsed.data.consentText ?? null,
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
      [session.tenantId, session.memberId, parsed.data.purpose, parsed.data.ripdVersion ?? 'v1.0'],
    )
    return { ok: true, consentId: ins.rows[0]!.id, granted: false }
  })
}
