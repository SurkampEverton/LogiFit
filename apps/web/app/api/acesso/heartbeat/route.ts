/**
 * POST /api/acesso/heartbeat — Sprint 08 Faixa B.
 *
 * Catraca pinga cada 30s. Atualiza `access_devices.last_heartbeat`.
 * Job `check-device-heartbeat` (Sprint 09+) marca offline se silêncio >2min
 * e emite `device.offline` event.
 */
import { pool } from '@repo/db/client'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: Request) {
  const deviceToken = request.headers.get('x-device-token') ?? ''
  if (!deviceToken) {
    return NextResponse.json({ ok: false, error: 'missing device token' }, { status: 401 })
  }
  const tokenHash = hashDeviceToken(deviceToken)

  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE access_devices
         SET last_heartbeat = now()
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING id`,
      [tokenHash],
    )
    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'invalid device' }, { status: 401 })
    }
    return NextResponse.json({ ok: true, deviceId: result.rows[0]?.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({ level: 'error', module: 'api.acesso.heartbeat', error: message }),
    )
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
