/**
 * Diário + Teleconsulta RLS + checks — Sprint 31 Faixa A.
 *
 * Valida:
 *   - meal_log_entries: isolation per-tenant; check has_content (pelo menos 1 fonte)
 *   - food_log_daily_summary: PK (tenant, member, date); check adherence_pct range
 *   - meal_log_reviews: isolation
 *   - teleconsultation_sessions: isolation; check ended_consistency + consent flags
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
     VALUES ($1, 'pf', 'Test Diario Member', 'test-diario-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

async function getUser(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Prof Diario', 'prof-diario-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-diario-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool
    .query(`DELETE FROM teleconsultation_sessions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_log_reviews WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM food_log_daily_summary WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_log_entries WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query(`DELETE FROM teleconsultation_sessions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_log_reviews WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM food_log_daily_summary WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_log_entries WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
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

describe('meal_log_entries — checks + isolation', () => {
  it('check has_content: tudo NULL rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO meal_log_entries (tenant_id, member_id, consumed_date, meal_name)
         VALUES ($1, $2, CURRENT_DATE, 'almoco')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('com free_text OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO meal_log_entries (tenant_id, member_id, consumed_date, meal_name, free_text_description)
         VALUES ($1, $2, CURRENT_DATE, 'almoco', 'Arroz, feijão e bife')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('com foods_structured OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO meal_log_entries (tenant_id, member_id, consumed_date, meal_name, foods_structured)
         VALUES ($1, $2, CURRENT_DATE, 'cafe', '[{"food_id":"abc","grams":50}]'::jsonb)`,
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
      `INSERT INTO meal_log_entries (tenant_id, member_id, consumed_date, meal_name, free_text_description)
       VALUES ($1, $2, CURRENT_DATE, 'cafe', 'café') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const eId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM meal_log_entries WHERE id = $1`, [eId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM meal_log_entries WHERE id = $1`, [eId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('food_log_daily_summary — checks', () => {
  it('PK (tenant, member, date) — duplicata rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    await pool.query(
      `INSERT INTO food_log_daily_summary (tenant_id, member_id, consumed_date, total_kcal)
       VALUES ($1, $2, '2026-05-18', 1800)`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO food_log_daily_summary (tenant_id, member_id, consumed_date, total_kcal)
         VALUES ($1, $2, '2026-05-18', 1900)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('check adherence_pct range — fora rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO food_log_daily_summary (tenant_id, member_id, consumed_date, adherence_pct)
         VALUES ($1, $2, '2026-05-18', 150)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('adherence_pct NULL OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO food_log_daily_summary (tenant_id, member_id, consumed_date, total_kcal)
         VALUES ($1, $2, '2026-05-18', 1800)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('meal_log_reviews — isolation', () => {
  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const e = await pool.query<{ id: string }>(
      `INSERT INTO meal_log_entries (tenant_id, member_id, consumed_date, meal_name, free_text_description)
       VALUES ($1, $2, CURRENT_DATE, 'almoco', 'test') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const r = await pool.query<{ id: string }>(
      `INSERT INTO meal_log_reviews (tenant_id, entry_id, reviewed_by_user_id, status, comment)
       VALUES ($1, $2, $3, 'approved', 'OK') RETURNING id`,
      [TENANT_REDE, e.rows[0]!.id, userId],
    )
    const rId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM meal_log_reviews WHERE id = $1`, [rId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM meal_log_reviews WHERE id = $1`, [rId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('teleconsultation_sessions — checks + isolation', () => {
  async function createBaseTeleconsulta(tenantId: string): Promise<string> {
    const memberId = await getOrCreateMember(tenantId)
    const userId = await getUser(tenantId)
    // Cria appointment mínimo
    const companyId = await getMatriz(tenantId)
    const res = await pool.query<{ id: string }>(
      `INSERT INTO resources (tenant_id, company_id, kind, name)
       VALUES ($1, $2, 'instrutor', 'Test Prof') RETURNING id`,
      [tenantId, companyId],
    )
    const apt = await pool.query<{ id: string }>(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '2 hours') RETURNING id`,
      [tenantId, res.rows[0]!.id, memberId],
    )
    const r = await pool.query<{ id: string }>(
      `INSERT INTO teleconsultation_sessions
       (tenant_id, appointment_id, member_id, professional_user_id, provider, room_id)
       VALUES ($1, $2, $3, $4, 'daily', 'test-room-' || gen_random_uuid()::text) RETURNING id`,
      [tenantId, apt.rows[0]!.id, memberId, userId],
    )
    return r.rows[0]!.id
  }

  it('insert válido OK', async () => {
    let errCode = ''
    try {
      await createBaseTeleconsulta(TENANT_REDE)
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check ended_consistency: status=ended sem ended_at rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const res = await pool.query<{ id: string }>(
      `INSERT INTO resources (tenant_id, company_id, kind, name)
       VALUES ($1, $2, 'instrutor', 'TC Prof2') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const apt = await pool.query<{ id: string }>(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '2 hours') RETURNING id`,
      [TENANT_REDE, res.rows[0]!.id, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO teleconsultation_sessions
         (tenant_id, appointment_id, member_id, professional_user_id, provider, room_id, status)
         VALUES ($1, $2, $3, $4, 'daily', 'test-room-bad', 'ended')`,
        [TENANT_REDE, apt.rows[0]!.id, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check recording_requires_consent: path sem consent rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const res = await pool.query<{ id: string }>(
      `INSERT INTO resources (tenant_id, company_id, kind, name)
       VALUES ($1, $2, 'instrutor', 'TC Prof3') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const apt = await pool.query<{ id: string }>(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '2 hours') RETURNING id`,
      [TENANT_REDE, res.rows[0]!.id, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO teleconsultation_sessions
         (tenant_id, appointment_id, member_id, professional_user_id, provider, room_id,
          recording_storage_path, recording_consent_granted)
         VALUES ($1, $2, $3, $4, 'daily', 'test-room-noc', '/rec/x.mp4', false)`,
        [TENANT_REDE, apt.rows[0]!.id, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const tId = await createBaseTeleconsulta(TENANT_REDE)
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM teleconsultation_sessions WHERE id = $1`, [tId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM teleconsultation_sessions WHERE id = $1`, [tId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
