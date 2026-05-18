'use server'

/**
 * Server Actions Device Hub (portal /meu/dispositivos) — Sprint 32 Faixa B.2 (ADR 0049).
 *
 * Caller é PACIENTE. Usa `wrapMemberAction` (Sprint 02c2).
 *
 * Actions:
 *   - startConnection({provider}) — OAuth/BLE init
 *   - completeConnection({provider, code, state}) — OAuth callback
 *   - disconnect({connectionId, reason?})
 *   - listMyConnections()
 *   - listMyReadings({observationCode?, fromDate?, toDate?, limit})
 *   - importInBodyCsv({content}) — parse + ingest
 *   - grantDeviceConsent({provider, purposes[], rawDataAccess?})
 *   - revokeDeviceConsent({consentId})
 *
 * Sprint 32b: providers reais Garmin/Oura via safeFetch + envelope encryption tokens.
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { resolveDeviceProvider, partitionValidReadings, parseInBodyCsv } from '@repo/ai'
import type { DeviceProviderName } from '@repo/ai'
import { z } from 'zod'
import { wrapMemberAction } from '../../lib/wrap-member-action'

const DEVICE_PROVIDER_ENUM = [
  'garmin',
  'oura',
  'fitbit',
  'apple_health',
  'google_health',
  'ble_scale_omron',
  'ble_scale_gtech',
  'file_import',
  'mock',
] as const

const StartConnectionSchema = z.object({
  provider: z.enum(DEVICE_PROVIDER_ENUM),
  redirectUri: z.string().url().optional(),
})

const CompleteConnectionSchema = z.object({
  provider: z.enum(DEVICE_PROVIDER_ENUM),
  code: z.string().min(2).max(500),
  state: z.string().min(2).max(500),
  redirectUri: z.string().url().optional(),
})

const DisconnectSchema = z.object({
  connectionId: z.string().uuid(),
  reason: z.string().max(200).optional().nullable(),
})

const ListReadingsSchema = z.object({
  observationCode: z.string().max(40).optional().nullable(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  limit: z.number().int().min(1).max(500).default(100),
})

const ImportCsvSchema = z.object({
  content: z.string().min(10).max(5_000_000), // 5MB max
})

const GrantConsentSchema = z.object({
  provider: z.enum(DEVICE_PROVIDER_ENUM),
  purposes: z.array(z.string().max(80)).min(1).max(20),
  rawDataAccess: z.boolean().default(false),
  ripdVersion: z.string().max(20).default('v1.0'),
})

const RevokeConsentSchema = z.object({
  consentId: z.string().uuid(),
})

// ─── startConnection ────────────────────────────────────────────────────

export const startConnection = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.start_connection',
    returnTo: '/meu/dispositivos',
    resourceType: 'device_connections',
    schema: StartConnectionSchema,
  },
  async (input, { session }) => {
    // Verifica se já existe connection ativa do mesmo provider
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM device_connections
       WHERE member_id = $1 AND provider = $2::device_provider AND status IN ('active', 'pending')
       LIMIT 1`,
      [session.memberId, input.provider],
    )
    if (existing.rows.length > 0) {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Já existe conexão ativa para ${input.provider}. Desconecte primeiro.`,
        request_id: '',
      })
    }

    const provider = resolveDeviceProvider(input.provider as DeviceProviderName)
    const redirectUri =
      input.redirectUri ?? `https://logifit.local/meu/dispositivos/${input.provider}/callback`
    const { authUrl, state } = await provider.startAuth({
      memberId: session.memberId,
      redirectUri,
    })

    // Cria connection com status='pending' até o callback completar
    await pool.query(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status, metadata)
       VALUES ($1, $2, $3::device_provider, 'pending', $4::jsonb)`,
      [
        session.tenantId,
        session.memberId,
        input.provider,
        JSON.stringify({ state, redirectUri }),
      ],
    )

    return { ok: true as const, authUrl, state }
  },
)

// ─── completeConnection ─────────────────────────────────────────────────

export const completeConnection = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.complete_connection',
    returnTo: '/meu/dispositivos',
    resourceType: 'device_connections',
    schema: CompleteConnectionSchema,
  },
  async (input, { session }) => {
    // Busca connection pending do mesmo provider
    const conn = await pool.query<{
      id: string
      metadata: { state?: string; redirectUri?: string }
    }>(
      `SELECT id, metadata FROM device_connections
       WHERE member_id = $1 AND provider = $2::device_provider AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [session.memberId, input.provider],
    )
    if (conn.rows.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Nenhuma conexão pendente encontrada — inicie via startConnection',
        request_id: '',
      })
    }
    const c = conn.rows[0]!
    if (c.metadata?.state !== input.state) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'State OAuth inválido',
        request_id: '',
      })
    }

    const provider = resolveDeviceProvider(input.provider as DeviceProviderName)
    const { accessToken, refreshToken, expiresAt, externalUserId, deviceLabel } =
      await provider.completeAuth({
        code: input.code,
        state: input.state,
        redirectUri: input.redirectUri ?? c.metadata?.redirectUri ?? '',
      })

    await pool.query(
      `UPDATE device_connections
       SET access_token_encrypted = $1, refresh_token_encrypted = $2,
           expires_at = $3, external_user_id = $4, device_label = $5,
           status = 'active', connected_at = now(), updated_at = now()
       WHERE id = $6`,
      [accessToken, refreshToken, expiresAt, externalUserId, deviceLabel, c.id],
    )

    return { ok: true as const, connectionId: c.id }
  },
)

// ─── disconnect ─────────────────────────────────────────────────────────

export const disconnect = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.disconnect',
    returnTo: '/meu/dispositivos',
    resourceType: 'device_connections',
    schema: DisconnectSchema,
  },
  async (input, { session }) => {
    const r = await pool.query<{
      provider: string
      access_token_encrypted: string | null
    }>(
      `SELECT provider::text AS provider, access_token_encrypted
       FROM device_connections
       WHERE id = $1 AND member_id = $2
       LIMIT 1`,
      [input.connectionId, session.memberId],
    )
    if (r.rows.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Connection não encontrada',
        request_id: '',
      })
    }
    const c = r.rows[0]!

    // Best-effort revoke no provider
    try {
      if (c.access_token_encrypted) {
        const provider = resolveDeviceProvider(c.provider as DeviceProviderName)
        await provider.revoke({ accessToken: c.access_token_encrypted })
      }
    } catch (err) {
      console.warn('[devices] revoke no provider falhou:', err)
    }

    await pool.query(
      `UPDATE device_connections
       SET status = 'revoked', revoked_at = now(), updated_at = now(),
           access_token_encrypted = NULL, refresh_token_encrypted = NULL
       WHERE id = $1`,
      [input.connectionId],
    )

    return { ok: true as const }
  },
)

// ─── listMyConnections ──────────────────────────────────────────────────

interface ConnRow {
  id: string
  provider: string
  status: string
  device_label: string | null
  connected_at: Date
  last_synced_at: Date | null
  last_error: string | null
}

export const listMyConnections = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.list_connections',
    returnTo: '/meu/dispositivos',
  },
  async (_input: void, { session }) => {
    const r = await pool.query<ConnRow>(
      `SELECT id, provider::text AS provider, status::text AS status,
              device_label, connected_at, last_synced_at, last_error
       FROM device_connections
       WHERE member_id = $1
       ORDER BY connected_at DESC`,
      [session.memberId],
    )
    return { ok: true as const, rows: r.rows }
  },
)

// ─── listMyReadings ─────────────────────────────────────────────────────

interface ReadingRow {
  id: string
  observation_code: string
  value: string
  unit: string
  measured_at: Date
  source_provider: string
  quality: string | null
}

export const listMyReadings = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.list_readings',
    returnTo: '/meu/dispositivos/historico',
    schema: ListReadingsSchema,
  },
  async (input, { session }) => {
    const conditions: string[] = ['member_id = $1']
    const params: unknown[] = [session.memberId]
    let i = 2
    if (input.observationCode) {
      conditions.push(`observation_code = $${i++}`)
      params.push(input.observationCode)
    }
    if (input.fromDate) {
      conditions.push(`measured_at >= $${i++}::date`)
      params.push(input.fromDate)
    }
    if (input.toDate) {
      conditions.push(`measured_at <= ($${i++}::date + INTERVAL '1 day')`)
      params.push(input.toDate)
    }
    params.push(input.limit)

    const r = await pool.query<ReadingRow>(
      `SELECT id, observation_code, value::text AS value, unit, measured_at,
              source_provider::text AS source_provider, quality
       FROM device_readings
       WHERE ${conditions.join(' AND ')}
       ORDER BY measured_at DESC
       LIMIT $${i}`,
      params,
    )
    return { ok: true as const, rows: r.rows }
  },
)

// ─── importInBodyCsv ────────────────────────────────────────────────────

export const importInBodyCsv = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.import_csv',
    returnTo: '/meu/dispositivos/importar',
    resourceType: 'device_readings',
    schema: ImportCsvSchema,
  },
  async (input, { session }) => {
    // 1. Garante connection file_import existe
    let connId: string
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM device_connections
       WHERE member_id = $1 AND provider = 'file_import' AND status = 'active'
       LIMIT 1`,
      [session.memberId],
    )
    if (existing.rows.length > 0) {
      connId = existing.rows[0]!.id
    } else {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO device_connections (tenant_id, member_id, provider, status, device_label, connected_at)
         VALUES ($1, $2, 'file_import', 'active', 'Arquivo (InBody/CSV)', now())
         RETURNING id`,
        [session.tenantId, session.memberId],
      )
      connId = ins.rows[0]!.id
    }

    // 2. Parse + validação
    const parsedCsv = parseInBodyCsv(input.content)
    const { valid, invalid } = partitionValidReadings(parsedCsv.readings)

    // 3. Ingest leituras válidas (ON CONFLICT DO NOTHING — dedup unique)
    let inserted = 0
    for (const r of valid) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO device_readings
         (tenant_id, member_id, connection_id, observation_code, value, unit,
          measured_at, source_provider, quality, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'file_import', $8, $9::jsonb)
         ON CONFLICT (connection_id, observation_code, measured_at) DO NOTHING
         RETURNING id`,
        [
          session.tenantId,
          session.memberId,
          connId,
          r.observationCode,
          r.value,
          r.unit,
          r.measuredAt,
          r.quality ?? null,
          JSON.stringify(r.metadata ?? {}),
        ],
      )
      if (result.rowCount && result.rowCount > 0) inserted++
    }

    // 4. Atualiza last_synced_at
    await pool.query(
      `UPDATE device_connections
       SET last_synced_at = now(), updated_at = now()
       WHERE id = $1`,
      [connId],
    )

    return {
      ok: true as const,
      connectionId: connId,
      inserted,
      validReadings: valid.length,
      invalidReadings: invalid.length,
      parseErrors: parsedCsv.errors,
    }
  },
)

// ─── grantDeviceConsent / revokeDeviceConsent ────────────────────────────

export const grantDeviceConsent = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.grant_consent',
    returnTo: '/meu/dispositivos/consent',
    resourceType: 'device_consents',
    schema: GrantConsentSchema,
  },
  async (input, { session }) => {
    // Revoga consent anterior do mesmo provider (1 ativo por par)
    await pool.query(
      `UPDATE device_consents
       SET revoked_at = now()
       WHERE member_id = $1 AND provider = $2::device_provider AND revoked_at IS NULL`,
      [session.memberId, input.provider],
    )

    const r = await pool.query<{ id: string }>(
      `INSERT INTO device_consents
       (tenant_id, member_id, provider, purposes, raw_data_access_granted, ripd_version)
       VALUES ($1, $2, $3::device_provider, $4::text[], $5, $6)
       RETURNING id`,
      [
        session.tenantId,
        session.memberId,
        input.provider,
        input.purposes,
        input.rawDataAccess,
        input.ripdVersion,
      ],
    )

    return { ok: true as const, id: r.rows[0]!.id }
  },
)

export const revokeDeviceConsent = wrapMemberAction(
  {
    module: 'meu.dispositivos',
    action: 'device.revoke_consent',
    returnTo: '/meu/dispositivos/consent',
    resourceType: 'device_consents',
    schema: RevokeConsentSchema,
  },
  async (input, { session }) => {
    const r = await pool.query(
      `UPDATE device_consents
       SET revoked_at = now()
       WHERE id = $1 AND member_id = $2 AND revoked_at IS NULL`,
      [input.consentId, session.memberId],
    )
    if (r.rowCount === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consent não encontrado',
        request_id: '',
      })
    }
    return { ok: true as const }
  },
)
