'use server'

/**
 * Server Actions Device Hub (portal /meu/dispositivos) — Sprint 32 Faixa B.2 (ADR 0049).
 *
 * Caller é PACIENTE. Usa requireMemberSession + withMemberContext.
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
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  requireMemberSession,
  withMemberContext,
} from '../../lib/member-session'

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

export async function startConnection(input: unknown) {
  const parsed = StartConnectionSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues.map((i) => i.message).join('; '),
      request_id: randomUUID(),
    })
  }
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
    // Verifica se já existe connection ativa do mesmo provider
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM device_connections
       WHERE member_id = $1 AND provider = $2::device_provider AND status IN ('active', 'pending')
       LIMIT 1`,
      [session.memberId, parsed.data.provider],
    )
    if (existing.rows.length > 0) {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Já existe conexão ativa para ${parsed.data.provider}. Desconecte primeiro.`,
        request_id: randomUUID(),
      })
    }

    const provider = resolveDeviceProvider(parsed.data.provider as DeviceProviderName)
    const redirectUri = parsed.data.redirectUri ?? `https://logifit.local/meu/dispositivos/${parsed.data.provider}/callback`
    const { authUrl, state } = await provider.startAuth({
      memberId: session.memberId,
      redirectUri,
    })

    // Cria connection com status='pending' até o callback completar
    await pool.query(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status, metadata)
       VALUES ($1, $2, $3::device_provider, 'pending', $4::jsonb)`,
      [session.tenantId, session.memberId, parsed.data.provider, JSON.stringify({ state, redirectUri })],
    )

    return { ok: true as const, authUrl, state }
  })
}

// ─── completeConnection ─────────────────────────────────────────────────

export async function completeConnection(input: unknown) {
  const parsed = CompleteConnectionSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
    // Busca connection pending do mesmo provider
    const conn = await pool.query<{ id: string; metadata: { state?: string; redirectUri?: string } }>(
      `SELECT id, metadata FROM device_connections
       WHERE member_id = $1 AND provider = $2::device_provider AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [session.memberId, parsed.provider],
    )
    if (conn.rows.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Nenhuma conexão pendente encontrada — inicie via startConnection',
        request_id: randomUUID(),
      })
    }
    const c = conn.rows[0]!
    if (c.metadata?.state !== parsed.state) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'State OAuth inválido',
        request_id: randomUUID(),
      })
    }

    const provider = resolveDeviceProvider(parsed.provider as DeviceProviderName)
    const { accessToken, refreshToken, expiresAt, externalUserId, deviceLabel } = await provider.completeAuth({
      code: parsed.code,
      state: parsed.state,
      redirectUri: parsed.redirectUri ?? c.metadata?.redirectUri ?? '',
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
  })
}

// ─── disconnect ─────────────────────────────────────────────────────────

export async function disconnect(input: unknown) {
  const parsed = DisconnectSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
    const r = await pool.query<{
      provider: string
      access_token_encrypted: string | null
    }>(
      `SELECT provider::text AS provider, access_token_encrypted
       FROM device_connections
       WHERE id = $1 AND member_id = $2
       LIMIT 1`,
      [parsed.connectionId, session.memberId],
    )
    if (r.rows.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Connection não encontrada',
        request_id: randomUUID(),
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
      [parsed.connectionId],
    )

    return { ok: true as const }
  })
}

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

export async function listMyConnections() {
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
    const r = await pool.query<ConnRow>(
      `SELECT id, provider::text AS provider, status::text AS status,
              device_label, connected_at, last_synced_at, last_error
       FROM device_connections
       WHERE member_id = $1
       ORDER BY connected_at DESC`,
      [session.memberId],
    )
    return { ok: true as const, rows: r.rows }
  })
}

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

export async function listMyReadings(input: unknown) {
  const parsed = ListReadingsSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
    const conditions: string[] = ['member_id = $1']
    const params: unknown[] = [session.memberId]
    let i = 2
    if (parsed.observationCode) {
      conditions.push(`observation_code = $${i++}`)
      params.push(parsed.observationCode)
    }
    if (parsed.fromDate) {
      conditions.push(`measured_at >= $${i++}::date`)
      params.push(parsed.fromDate)
    }
    if (parsed.toDate) {
      conditions.push(`measured_at <= ($${i++}::date + INTERVAL '1 day')`)
      params.push(parsed.toDate)
    }
    params.push(parsed.limit)

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
  })
}

// ─── importInBodyCsv ────────────────────────────────────────────────────

export async function importInBodyCsv(input: unknown) {
  const parsed = ImportCsvSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos')

  return withMemberContext(session, async () => {
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
    const parsedCsv = parseInBodyCsv(parsed.content)
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
  })
}

// ─── grantDeviceConsent / revokeDeviceConsent ────────────────────────────

export async function grantDeviceConsent(input: unknown) {
  const parsed = GrantConsentSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos/consent')

  return withMemberContext(session, async () => {
    // Revoga consent anterior do mesmo provider (1 ativo por par)
    await pool.query(
      `UPDATE device_consents
       SET revoked_at = now()
       WHERE member_id = $1 AND provider = $2::device_provider AND revoked_at IS NULL`,
      [session.memberId, parsed.provider],
    )

    const r = await pool.query<{ id: string }>(
      `INSERT INTO device_consents
       (tenant_id, member_id, provider, purposes, raw_data_access_granted, ripd_version)
       VALUES ($1, $2, $3::device_provider, $4::text[], $5, $6)
       RETURNING id`,
      [
        session.tenantId,
        session.memberId,
        parsed.provider,
        parsed.purposes,
        parsed.rawDataAccess,
        parsed.ripdVersion,
      ],
    )

    return { ok: true as const, id: r.rows[0]!.id }
  })
}

export async function revokeDeviceConsent(input: unknown) {
  const parsed = RevokeConsentSchema.parse(input)
  const session = await requireMemberSession('/meu/dispositivos/consent')

  return withMemberContext(session, async () => {
    const r = await pool.query(
      `UPDATE device_consents
       SET revoked_at = now()
       WHERE id = $1 AND member_id = $2 AND revoked_at IS NULL`,
      [parsed.consentId, session.memberId],
    )
    if (r.rowCount === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Consent não encontrado',
        request_id: randomUUID(),
      })
    }
    return { ok: true as const }
  })
}
