/**
 * POST /api/acesso/checkin — Sprint 08 Faixa B.
 *
 * Catraca envia `x-device-token` header + body `{ qr_token, kind? }`.
 * Pipeline:
 *   1. Resolve device via token_hash (sha256 do token plain) → tenantId
 *   2. Lookup access_secrets ativos do tenant (1-2 chaves rotativas)
 *   3. validateAccessToken(qr_token, secrets) → memberId
 *   4. Verifica access_blocks ativos do member → denied_block
 *   5. (Opcional) Verifica invoice overdue do member → denied_overdue
 *   6. INSERT access_event (kind=checkin OU denied_*)
 *   7. Realtime emit (LISTEN/NOTIFY canal `acesso:{tenant}:{unit}`)
 *
 * Sempre responde 200 com `{allow, reason?, member?}` — catraca exibe display.
 * Erros 4xx só pra token inválido do device (catraca ressincronizar).
 */
import { pool } from '@repo/db/client'
import { validateAccessToken } from '@repo/security'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface CheckinBody {
  qr_token?: string
  kind?: 'checkin' | 'checkout'
}

function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: Request) {
  const deviceToken = request.headers.get('x-device-token') ?? ''
  if (!deviceToken) {
    return NextResponse.json(
      { ok: false, error: 'missing device token' },
      { status: 401 },
    )
  }
  const tokenHash = hashDeviceToken(deviceToken)

  let body: CheckinBody = {}
  try {
    body = (await request.json()) as CheckinBody
  } catch {
    /* body opcional pra heartbeat */
  }

  const client = await pool.connect()
  try {
    // 1. Resolve device (bypass RLS via postgres role — catraca é sistema)
    const deviceRes = await client.query<{
      id: string
      tenant_id: string
      unit_id: string | null
      revoked_at: Date | null
    }>(
      `SELECT id, tenant_id, unit_id, revoked_at FROM access_devices WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    )
    const device = deviceRes.rows[0]
    if (!device || device.revoked_at !== null) {
      return NextResponse.json(
        { ok: false, error: 'invalid device' },
        { status: 401 },
      )
    }

    // 2. Lookup secrets ativos
    const secretsRes = await client.query<{ secret: string }>(
      `SELECT secret FROM access_secrets WHERE tenant_id = $1 AND active = true LIMIT 2`,
      [device.tenant_id],
    )
    const secrets = secretsRes.rows.map((r) => r.secret)

    if (!body.qr_token) {
      return NextResponse.json({ allow: false, reason: 'missing_qr_token' })
    }

    // 3. Valida QR token
    const validation = validateAccessToken(body.qr_token, secrets)
    if (!validation.valid) {
      await client.query(
        `INSERT INTO access_events (tenant_id, device_id, kind, auth_mode, raw)
         VALUES ($1, $2, 'denied_invalid_token', 'qr', $3::jsonb)`,
        [device.tenant_id, device.id, JSON.stringify({ reason: validation.reason })],
      )
      return NextResponse.json({ allow: false, reason: validation.reason })
    }
    const memberId = validation.memberId

    // 4. Bloqueios ativos
    const blockRes = await client.query<{ kind: string; reason: string }>(
      `SELECT kind, reason FROM access_blocks
       WHERE tenant_id = $1 AND member_id = $2 AND resolved_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1`,
      [device.tenant_id, memberId],
    )
    if (blockRes.rows.length > 0) {
      const block = blockRes.rows[0]
      await client.query(
        `INSERT INTO access_events (tenant_id, device_id, member_id, kind, auth_mode, raw)
         VALUES ($1, $2, $3, 'denied_block', 'qr', $4::jsonb)`,
        [device.tenant_id, device.id, memberId, JSON.stringify({ block_kind: block?.kind, reason: block?.reason })],
      )
      return NextResponse.json({
        allow: false,
        reason: 'blocked',
        block_kind: block?.kind,
        block_reason: block?.reason,
      })
    }

    // 5. Lookup nome do member (response display)
    const memberRes = await client.query<{ name: string }>(
      `SELECT p.name FROM members m
       JOIN persons p ON p.id = m.person_id
       WHERE m.id = $1 AND m.tenant_id = $2 LIMIT 1`,
      [memberId, device.tenant_id],
    )

    // 6. Grava check-in
    const kind = body.kind === 'checkout' ? 'checkout' : 'checkin'
    await client.query(
      `INSERT INTO access_events (tenant_id, device_id, member_id, kind, auth_mode, raw)
       VALUES ($1, $2, $3, $4, 'qr', $5::jsonb)`,
      [device.tenant_id, device.id, memberId, kind, JSON.stringify({ unit_id: device.unit_id })],
    )

    // 7. Realtime notify (canal acesso:{tenant}:{unit})
    const channel = device.unit_id
      ? `acesso:${device.tenant_id}:${device.unit_id}`
      : `acesso:${device.tenant_id}:_`
    await client.query(
      `SELECT pg_notify($1, $2::text)`,
      [
        channel,
        JSON.stringify({
          event: `member.${kind}`,
          member_id: memberId,
          device_id: device.id,
          at: new Date().toISOString(),
        }),
      ],
    )

    return NextResponse.json({
      allow: true,
      kind,
      member: { id: memberId, name: memberRes.rows[0]?.name ?? null },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ level: 'error', module: 'api.acesso.checkin', error: message }))
    return NextResponse.json({ allow: false, reason: 'internal_error' }, { status: 500 })
  } finally {
    client.release()
  }
}
