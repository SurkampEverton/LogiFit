'use server'

/**
 * Server Actions Mobile App backbone — Sprint 35 Faixa B (ADRs 0045+0046).
 *
 * Caller é PACIENTE via app nativo (Sprint 35b) com session member ativa.
 * Não tem UI web pra isso — endpoints existem pro app consumir.
 *
 * Migrado pra `wrapMemberAction` (Sprint 02c2) exceto `checkAppVersion` que
 * é endpoint público pré-login (sem session — wrap-exempt).
 *
 * Actions:
 *   - registerPushToken({platform, token, deviceId, deviceModel, osVersion, appVersion, locale})
 *   - listMyPushTokens()
 *   - revokeMyPushToken({tokenId, reason})
 *   - checkAppVersion({platform, currentVersion}) — público, retorna se precisa update
 *
 * Sprint 35b conecta APNs/FCM dispatcher real + Mobile sessions com refresh longo.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { z } from 'zod'
import { wrapMemberAction } from '../../lib/wrap-member-action'

const RegisterPushTokenSchema = z.object({
  platform: z.enum(['ios', 'android']),
  /** APNs token (iOS) ou FCM token (Android) — base64 ou hex */
  token: z.string().min(20).max(500),
  /** Device identifier opaco (UUID, IDFV) */
  deviceId: z.string().min(8).max(120).optional().nullable(),
  deviceModel: z.string().max(120).optional().nullable(),
  osVersion: z.string().max(40).optional().nullable(),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional().nullable(),
  locale: z.string().max(20).default('pt-BR'),
})

const RevokeTokenSchema = z.object({
  tokenId: z.string().uuid(),
  reason: z.string().max(120).default('user_logout'),
})

const CheckVersionSchema = z.object({
  platform: z.enum(['ios', 'android']),
  currentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
})

// ─── registerPushToken ──────────────────────────────────────────────────

export const registerPushToken = wrapMemberAction(
  {
    module: 'meu.mobile',
    action: 'mobile.register_push_token',
    returnTo: '/meu/mobile/push',
    resourceType: 'mobile_push_tokens',
    schema: RegisterPushTokenSchema,
  },
  async (input, { session }) => {
    // Revoga tokens anteriores do mesmo device (unique constraint força)
    if (input.deviceId) {
      await pool.query(
        `UPDATE mobile_push_tokens
         SET revoked_at = now(), revoked_reason = 'replaced_by_new_registration'
         WHERE member_id = $1 AND device_id = $2 AND platform = $3::mobile_platform AND revoked_at IS NULL`,
        [session.memberId, input.deviceId, input.platform],
      )
    }

    const r = await pool.query<{ id: string }>(
      `INSERT INTO mobile_push_tokens
       (tenant_id, member_id, platform, token, device_id, device_model, os_version, app_version, locale)
       VALUES ($1, $2, $3::mobile_platform, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        session.tenantId,
        session.memberId,
        input.platform,
        input.token,
        input.deviceId ?? null,
        input.deviceModel ?? null,
        input.osVersion ?? null,
        input.appVersion ?? null,
        input.locale,
      ],
    )

    return { ok: true as const, tokenId: r.rows[0]!.id }
  },
)

// ─── listMyPushTokens ──────────────────────────────────────────────────

interface PushTokenRow {
  id: string
  platform: string
  device_model: string | null
  os_version: string | null
  app_version: string | null
  registered_at: Date
  last_used_at: Date
  revoked_at: Date | null
}

export const listMyPushTokens = wrapMemberAction(
  {
    module: 'meu.mobile',
    action: 'mobile.list_push_tokens',
    returnTo: '/meu/mobile/push',
  },
  async (_input: void, { session }) => {
    const r = await pool.query<PushTokenRow>(
      `SELECT id, platform::text AS platform, device_model, os_version, app_version,
              registered_at, last_used_at, revoked_at
       FROM mobile_push_tokens
       WHERE member_id = $1
       ORDER BY last_used_at DESC
       LIMIT 20`,
      [session.memberId],
    )
    return { ok: true as const, rows: r.rows }
  },
)

// ─── revokeMyPushToken ─────────────────────────────────────────────────

export const revokeMyPushToken = wrapMemberAction(
  {
    module: 'meu.mobile',
    action: 'mobile.revoke_push_token',
    returnTo: '/meu/mobile/push',
    resourceType: 'mobile_push_tokens',
    schema: RevokeTokenSchema,
  },
  async (input, { session }) => {
    const r = await pool.query(
      `UPDATE mobile_push_tokens
       SET revoked_at = now(), revoked_reason = $1
       WHERE id = $2 AND member_id = $3 AND revoked_at IS NULL`,
      [input.reason, input.tokenId, session.memberId],
    )
    if (r.rowCount === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Token não encontrado ou já revogado',
        request_id: '',
      })
    }
    return { ok: true as const }
  },
)

// ─── checkAppVersion (sem session — endpoint público pré-login) ────────

export interface VersionCheckResult {
  ok: true
  /** Versão mínima exigida pela plataforma */
  minRequired: string | null
  /** True se app está abaixo da mínima — força update */
  updateRequired: boolean
  /** Última versão publicada (pode haver update opcional) */
  latestVersion: string | null
  /** True se há versão mais nova disponível (não obrigatório) */
  updateAvailable: boolean
  /** URL da app store */
  storeUrl: string | null
  releaseNotes: string | null
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
  }
  return 0
}

/**
 * Pública (sem auth). App chama em boot pra saber se precisa atualizar.
 * Não precisa de member session — apenas leitura do registry global.
 */
// wrap-exempt: endpoint público pré-login (sem session pra wrap); app nativo chama em boot
export async function checkAppVersion(input: unknown): Promise<VersionCheckResult> {
  const parsed = CheckVersionSchema.parse(input)

  const r = await pool.query<{
    version: string
    min_required: boolean
    store_url: string | null
    release_notes: string | null
  }>(
    `SELECT version, min_required, store_url, release_notes
     FROM mobile_app_versions
     WHERE platform = $1::mobile_platform AND sunset = false
     ORDER BY published_at DESC
     LIMIT 50`,
    [parsed.platform],
  )

  if (r.rows.length === 0) {
    return {
      ok: true,
      minRequired: null,
      updateRequired: false,
      latestVersion: null,
      updateAvailable: false,
      storeUrl: null,
      releaseNotes: null,
    }
  }

  // Latest = ordem desc
  const latest = r.rows[0]!
  // Min required = mais recente com min_required=true
  const minRow = r.rows.find((x) => x.min_required)
  const minVersion = minRow?.version ?? null

  const updateRequired = minVersion
    ? compareSemver(parsed.currentVersion, minVersion) < 0
    : false
  const updateAvailable = compareSemver(parsed.currentVersion, latest.version) < 0

  return {
    ok: true,
    minRequired: minVersion,
    updateRequired,
    latestVersion: latest.version,
    updateAvailable,
    storeUrl: latest.store_url,
    releaseNotes: latest.release_notes,
  }
}
