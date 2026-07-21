/**
 * Nutri-labs RLS + checks — Sprint 30 Faixa A.
 *
 * Valida:
 *   - supplements: global vs tenant; INSERT global rejeitado
 *   - supplement_prescriptions: isolation per-tenant; duration_days positive
 *   - lab_analytes + lab_reference_ranges: global read-all
 *   - lab_reference_ranges: check at_least_one_bound + age_consistent
 *   - lab_results: isolation; check out_of_range_direction_consistent
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
     VALUES ($1, 'pf', 'Test Lab Member', 'test-lab-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

async function getUser(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [
    tenantId,
  ])
  if (r.rows[0]) return r.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Prof Lab', 'prof-lab-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-lab-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // Seed analyte mínimo pra testes (idempotente)
  await pool.query(`
    INSERT INTO lab_analytes (code, name, category, unit) VALUES
      ('TEST_GLICOSE', 'Glicose teste', 'bioquimico', 'mg/dL'),
      ('TEST_VITD', 'Vitamina D teste', 'vitamina_mineral', 'ng/mL')
    ON CONFLICT (code) DO NOTHING
  `)
})

afterAll(async () => {
  await pool
    .query(`DELETE FROM lab_results WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplement_prescriptions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplement_interactions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplements WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM lab_reference_ranges WHERE analyte_id IN (SELECT id FROM lab_analytes WHERE code LIKE 'TEST_%')`,
    )
    .catch(() => {})
  await pool.query(`DELETE FROM lab_analytes WHERE code LIKE 'TEST_%'`).catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query(`DELETE FROM lab_results WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplement_prescriptions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplement_interactions WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM supplements WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
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

describe('supplements — global + tenant override', () => {
  it('global (tenant_id NULL) visível em ambos tenants', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES (NULL, 'Vitamina D3 Teste', 'vitamina d3 teste', 'vitamin')
       RETURNING id`,
    )
    const sId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM supplements WHERE id = $1`, [sId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM supplements WHERE id = $1`, [sId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(1)
    await pool.query('DELETE FROM supplements WHERE id = $1', [sId])
  })

  it('tenant custom só visível pelo dono', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES ($1, 'Suplemento Custom', 'suplemento custom', 'blend')
       RETURNING id`,
      [TENANT_REDE],
    )
    const sId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM supplements WHERE id = $1`, [sId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM supplements WHERE id = $1`, [sId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('unique global name por kind', async () => {
    await pool.query(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES (NULL, 'Unique Test', 'unique test', 'vitamin')`,
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
         VALUES (NULL, 'Outro nome', 'unique test', 'vitamin')`,
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
    await pool.query(`DELETE FROM supplements WHERE name_normalized = 'unique test'`)
  })
})

describe('supplement_prescriptions — checks', () => {
  it('duration_days positive', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const s = await pool.query<{ id: string }>(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES ($1, 'Test Supp', 'test supp', 'vitamin') RETURNING id`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO supplement_prescriptions
         (tenant_id, member_id, supplement_id, professional_user_id, dose, frequency, duration_days, started_at)
         VALUES ($1, $2, $3, $4, '1000UI', '1x ao dia', -5, CURRENT_DATE)`,
        [TENANT_REDE, memberId, s.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('ended_after_started', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const s = await pool.query<{ id: string }>(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES ($1, 'Test Supp2', 'test supp2', 'vitamin') RETURNING id`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO supplement_prescriptions
         (tenant_id, member_id, supplement_id, professional_user_id, dose, frequency, started_at, ended_at)
         VALUES ($1, $2, $3, $4, '1000UI', '1x ao dia', '2026-05-10', '2026-05-01')`,
        [TENANT_REDE, memberId, s.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const s = await pool.query<{ id: string }>(
      `INSERT INTO supplements (tenant_id, name, name_normalized, kind)
       VALUES ($1, 'Iso Supp', 'iso supp', 'vitamin') RETURNING id`,
      [TENANT_REDE],
    )
    const p = await pool.query<{ id: string }>(
      `INSERT INTO supplement_prescriptions
       (tenant_id, member_id, supplement_id, professional_user_id, dose, frequency, started_at)
       VALUES ($1, $2, $3, $4, '1000UI', '1x ao dia', CURRENT_DATE) RETURNING id`,
      [TENANT_REDE, memberId, s.rows[0]!.id, userId],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM supplement_prescriptions WHERE id = $1`, [
          p.rows[0]!.id,
        ])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM supplement_prescriptions WHERE id = $1`, [
          p.rows[0]!.id,
        ])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('lab_analytes — global read-all', () => {
  it('analytes visíveis em ambos tenants', async () => {
    const [redeCount, franqCount] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM lab_analytes WHERE code LIKE 'TEST_%'`,
        )
        return Number(r.rows[0]!.n)
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM lab_analytes WHERE code LIKE 'TEST_%'`,
        )
        return Number(r.rows[0]!.n)
      }),
    ])
    expect(redeCount).toBeGreaterThanOrEqual(2)
    expect(franqCount).toBeGreaterThanOrEqual(2)
  })
})

describe('lab_reference_ranges — checks', () => {
  it('at_least_one_bound: ambos NULL rejeita', async () => {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM lab_analytes WHERE code = 'TEST_GLICOSE' LIMIT 1`,
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_reference_ranges (analyte_id, min_value, max_value)
         VALUES ($1, NULL, NULL)`,
        [a.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('age_consistent: age_min > age_max rejeita', async () => {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM lab_analytes WHERE code = 'TEST_GLICOSE' LIMIT 1`,
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_reference_ranges (analyte_id, age_min_years, age_max_years, min_value, max_value)
         VALUES ($1, 50, 30, 70, 99)`,
        [a.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('age_consistent: age_min <= age_max OK', async () => {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM lab_analytes WHERE code = 'TEST_GLICOSE' LIMIT 1`,
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_reference_ranges (analyte_id, age_min_years, age_max_years, min_value, max_value)
         VALUES ($1, 18, 65, 70, 99)`,
        [a.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('lab_results — isolation + checks', () => {
  async function getAnalyteId(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM lab_analytes WHERE code = 'TEST_GLICOSE' LIMIT 1`,
    )
    return r.rows[0]!.id
  }

  it('insert válido OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const analyteId = await getAnalyteId()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_results
         (tenant_id, member_id, analyte_id, value, unit, collected_at)
         VALUES ($1, $2, $3, 95, 'mg/dL', CURRENT_DATE)`,
        [TENANT_REDE, memberId, analyteId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('out_of_range_direction consistency: out_of_range=true sem direction rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const analyteId = await getAnalyteId()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_results
         (tenant_id, member_id, analyte_id, value, unit, collected_at, out_of_range)
         VALUES ($1, $2, $3, 200, 'mg/dL', CURRENT_DATE, true)`,
        [TENANT_REDE, memberId, analyteId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('out_of_range=true + direction OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const analyteId = await getAnalyteId()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lab_results
         (tenant_id, member_id, analyte_id, value, unit, collected_at, out_of_range, out_of_range_direction)
         VALUES ($1, $2, $3, 200, 'mg/dL', CURRENT_DATE, true, 'above')`,
        [TENANT_REDE, memberId, analyteId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const analyteId = await getAnalyteId()
    const r = await pool.query<{ id: string }>(
      `INSERT INTO lab_results
       (tenant_id, member_id, analyte_id, value, unit, collected_at)
       VALUES ($1, $2, $3, 95, 'mg/dL', CURRENT_DATE) RETURNING id`,
      [TENANT_REDE, memberId, analyteId],
    )
    const lrId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM lab_results WHERE id = $1`, [lrId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM lab_results WHERE id = $1`, [lrId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
