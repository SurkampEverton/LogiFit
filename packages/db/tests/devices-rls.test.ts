/**
 * Device Hub RLS + checks — Sprint 32 Faixa A.
 *
 * Valida:
 *   - device_connections: unique active por (member, provider); isolation
 *   - device_readings: dedup por (connection, observation_code, measured_at); isolation
 *   - device_readings_daily_summary: PK + check min<=max
 *   - device_consents: 1 ativo por (member, provider)
 *   - device_incidents: tenant scope
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool

async function getMatriz(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE tenant_id = $1 AND type = 'matriz' LIMIT 1`,
    [tenantId],
  )
  return r.rows[0]!.id
}

async function getOrCreateMember(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM members WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const companyId = await getMatriz(tenantId)
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Device Member', 'test-device-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool
    .query(`DELETE FROM device_incidents WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM device_consents WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM device_readings_curated WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM device_readings_daily_summary WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM device_readings WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM device_connections WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const t of [
    'device_incidents',
    'device_consents',
    'device_readings_curated',
    'device_readings_daily_summary',
    'device_readings',
    'device_sync_cursors',
    'device_connections',
  ]) {
    await pool
      .query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
})

async function withTenantContext<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('SET ROLE logifit_app')
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId])
    return await fn(client)
  } finally {
    try {
      await client.query("SELECT set_config('app.tenant_id', '', false)")
      await client.query('RESET ROLE')
    } catch {
      /* ignore */
    }
    client.release()
  }
}

describe('device_connections — unique active + isolation', () => {
  it('unique active por (member, provider) rejeita 2º active', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status)
       VALUES ($1, $2, 'garmin', 'active')`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_connections (tenant_id, member_id, provider, status)
         VALUES ($1, $2, 'garmin', 'active')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('revoked + new active OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status, revoked_at)
       VALUES ($1, $2, 'oura', 'revoked', now())`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_connections (tenant_id, member_id, provider, status)
         VALUES ($1, $2, 'oura', 'active')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status)
       VALUES ($1, $2, 'fitbit', 'active') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM device_connections WHERE id = $1`, [cId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM device_connections WHERE id = $1`, [cId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('device_readings — dedup + isolation', () => {
  async function createConnection(tenantId: string, provider = 'garmin'): Promise<{
    memberId: string
    connectionId: string
  }> {
    const memberId = await getOrCreateMember(tenantId)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status)
       VALUES ($1, $2, $3::device_provider, 'active') RETURNING id`,
      [tenantId, memberId, provider],
    )
    return { memberId, connectionId: r.rows[0]!.id }
  }

  it('dedup por (connection, observation_code, measured_at)', async () => {
    const { memberId, connectionId } = await createConnection(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_readings
       (tenant_id, member_id, connection_id, observation_code, value, unit, measured_at, source_provider)
       VALUES ($1, $2, $3, 'HR', 75, 'bpm', '2026-05-18 10:00:00+00', 'garmin')`,
      [TENANT_REDE, memberId, connectionId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_readings
         (tenant_id, member_id, connection_id, observation_code, value, unit, measured_at, source_provider)
         VALUES ($1, $2, $3, 'HR', 76, 'bpm', '2026-05-18 10:00:00+00', 'garmin')`,
        [TENANT_REDE, memberId, connectionId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('isolation per-tenant', async () => {
    const { memberId, connectionId } = await createConnection(TENANT_REDE, 'oura')
    const r = await pool.query<{ id: string }>(
      `INSERT INTO device_readings
       (tenant_id, member_id, connection_id, observation_code, value, unit, measured_at, source_provider)
       VALUES ($1, $2, $3, 'STEPS', 8500, 'steps', '2026-05-18 23:00:00+00', 'oura') RETURNING id`,
      [TENANT_REDE, memberId, connectionId],
    )
    const rId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM device_readings WHERE id = $1`, [rId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM device_readings WHERE id = $1`, [rId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('device_readings_daily_summary — PK + checks', () => {
  it('PK (tenant, member, code, date) — duplicata rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_readings_daily_summary
       (tenant_id, member_id, observation_code, observed_date, min_value, max_value, avg_value, samples_count, unit)
       VALUES ($1, $2, 'HR_RESTING', '2026-05-18', 58, 72, 65, 1440, 'bpm')`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_readings_daily_summary
         (tenant_id, member_id, observation_code, observed_date, min_value, max_value, avg_value, samples_count, unit)
         VALUES ($1, $2, 'HR_RESTING', '2026-05-18', 60, 75, 67, 1440, 'bpm')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('check min_max: min > max rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_readings_daily_summary
         (tenant_id, member_id, observation_code, observed_date, min_value, max_value, avg_value, samples_count, unit)
         VALUES ($1, $2, 'HR', '2026-05-18', 120, 80, 100, 100, 'bpm')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('device_consents — 1 ativo por (member, provider)', () => {
  it('unique active rejeita 2º consent ativo do mesmo provider', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_consents (tenant_id, member_id, provider, purposes)
       VALUES ($1, $2, 'garmin', ARRAY['academia_hr'])`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_consents (tenant_id, member_id, provider, purposes)
         VALUES ($1, $2, 'garmin', ARRAY['nutri_weight'])`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('revoked + new active OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO device_consents (tenant_id, member_id, provider, purposes, revoked_at)
       VALUES ($1, $2, 'oura', ARRAY['academia_hr'], now())`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO device_consents (tenant_id, member_id, provider, purposes)
         VALUES ($1, $2, 'oura', ARRAY['nutri_weight'])`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('device_incidents — tenant scope', () => {
  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const conn = await pool.query<{ id: string }>(
      `INSERT INTO device_connections (tenant_id, member_id, provider, status)
       VALUES ($1, $2, 'garmin', 'error') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const inc = await pool.query<{ id: string }>(
      `INSERT INTO device_incidents (tenant_id, connection_id, kind, summary)
       VALUES ($1, $2, 'token_expired', 'Token expirou') RETURNING id`,
      [TENANT_REDE, conn.rows[0]!.id],
    )
    const iId = inc.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM device_incidents WHERE id = $1`, [iId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM device_incidents WHERE id = $1`, [iId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
