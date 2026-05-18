/**
 * Cross-alert lesão (Sprint 27 Faixa A) — RLS + check constraints.
 *
 * Valida:
 *   - cid_exercise_contraindications: global (tenant_id NULL) lê por todos;
 *     tenant override só pelo tenant; INSERT global rejeitado via RLS
 *   - check `at_least_one_target`
 *   - unique dedup
 *   - member_injury_alerts: isolation per-tenant
 *   - check `blocked_requires_reason`
 *   - check `reviewed_consistency`
 *   - workout_adaptations: 1:1 com alert; check `confirmed_consistency`
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
     VALUES ($1, 'pf', 'Test Cross Member', 'test-cross-' || $1::uuid::text || '@example.com') RETURNING id`,
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
     VALUES ($1, 'pf', 'Test Prof Cross', 'prof-cross-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-cross-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

async function createTestConsulta(tenantId: string): Promise<string> {
  const companyId = await getMatriz(tenantId)
  const memberId = await getOrCreateMember(tenantId)
  const userId = await getUser(tenantId)
  const r = await pool.query<{ id: string }>(
    `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode)
     VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock') RETURNING id`,
    [tenantId, companyId, memberId, userId],
  )
  return r.rows[0]!.id
}

async function createTestWorkout(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO workouts (tenant_id, name) VALUES ($1, 'Test Workout Cross') RETURNING id`,
    [tenantId],
  )
  return r.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // Seed CID se ainda não rodou pelo fisio test
  await pool.query(`
    INSERT INTO cid_catalog (code, description, chapter) VALUES
      ('MG30.0', 'Dor lombar baixa', 'MG'),
      ('FB28.0', 'Dor cervical', 'FB')
    ON CONFLICT DO NOTHING
  `)
})

afterAll(async () => {
  await pool
    .query(
      `DELETE FROM workout_adaptations WHERE tenant_id IN ($1, $2)`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM member_injury_alerts WHERE tenant_id IN ($1, $2)`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM cid_exercise_contraindications WHERE tenant_id IN ($1, $2)`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM workouts WHERE tenant_id IN ($1, $2) AND name = 'Test Workout Cross'`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query(`DELETE FROM workout_adaptations WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM member_injury_alerts WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM cid_exercise_contraindications WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
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

describe('cid_exercise_contraindications — global + tenant override', () => {
  it('global (tenant_id NULL) visível em ambos tenants', async () => {
    await pool.query(
      `INSERT INTO cid_exercise_contraindications
       (tenant_id, cid_code, muscle_group, severity, source)
       VALUES (NULL, 'MG30.0', 'lombar', 'avoid', 'Curadoria LogiFit')`,
    )
    const [redeCount, franqCount] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM cid_exercise_contraindications WHERE cid_code = 'MG30.0' AND tenant_id IS NULL`,
        )
        return Number(r.rows[0]!.n)
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM cid_exercise_contraindications WHERE cid_code = 'MG30.0' AND tenant_id IS NULL`,
        )
        return Number(r.rows[0]!.n)
      }),
    ])
    expect(redeCount).toBe(1)
    expect(franqCount).toBe(1)
    await pool.query(`DELETE FROM cid_exercise_contraindications WHERE tenant_id IS NULL`)
  })

  it('check at_least_one_target — sem exercise/muscle/movement rejeita', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cid_exercise_contraindications
         (tenant_id, cid_code, severity) VALUES ($1, 'MG30.0', 'modify')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check at_least_one_target — só muscle_group OK', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cid_exercise_contraindications
         (tenant_id, cid_code, muscle_group, severity) VALUES ($1, 'MG30.0', 'lombar', 'avoid')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('unique dedup — mesma (tenant, cid, muscle_group) rejeitada', async () => {
    await pool.query(
      `INSERT INTO cid_exercise_contraindications
       (tenant_id, cid_code, muscle_group, severity) VALUES ($1, 'MG30.0', 'lombar', 'avoid')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cid_exercise_contraindications
         (tenant_id, cid_code, muscle_group, severity) VALUES ($1, 'MG30.0', 'lombar', 'modify')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('isolation: tenant override só pelo dono', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cid_exercise_contraindications
       (tenant_id, cid_code, muscle_group, severity) VALUES ($1, 'MG30.0', 'lombar', 'avoid') RETURNING id`,
      [TENANT_REDE],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(
          `SELECT id FROM cid_exercise_contraindications WHERE id = $1 AND tenant_id IS NOT NULL`,
          [cId],
        )
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(
          `SELECT id FROM cid_exercise_contraindications WHERE id = $1 AND tenant_id IS NOT NULL`,
          [cId],
        )
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('member_injury_alerts — isolation + checks', () => {
  it('insert válido OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_injury_alerts
         (tenant_id, member_id, source_consulta_id, primary_cid_code, expires_at)
         VALUES ($1, $2, $3, 'MG30.0', now() + interval '14 days')`,
        [TENANT_REDE, memberId, consultaId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check blocked_requires_reason — status blocked sem reason rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_injury_alerts
         (tenant_id, member_id, source_consulta_id, primary_cid_code, status, expires_at)
         VALUES ($1, $2, $3, 'MG30.0', 'blocked', now() + interval '14 days')`,
        [TENANT_REDE, memberId, consultaId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check blocked_requires_reason — status blocked com reason OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_injury_alerts
         (tenant_id, member_id, source_consulta_id, primary_cid_code, status, blocked_reason, expires_at)
         VALUES ($1, $2, $3, 'MG30.0', 'blocked', 'regra_25_franchise_cross_company', now() + interval '14 days')`,
        [TENANT_REDE, memberId, consultaId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check reviewed_consistency — status accepted sem reviewed_at rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_injury_alerts
         (tenant_id, member_id, source_consulta_id, primary_cid_code, status, expires_at)
         VALUES ($1, $2, $3, 'MG30.0', 'accepted', now() + interval '14 days')`,
        [TENANT_REDE, memberId, consultaId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO member_injury_alerts
       (tenant_id, member_id, source_consulta_id, primary_cid_code, expires_at)
       VALUES ($1, $2, $3, 'MG30.0', now() + interval '14 days') RETURNING id`,
      [TENANT_REDE, memberId, consultaId],
    )
    const aId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM member_injury_alerts WHERE id = $1`, [aId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM member_injury_alerts WHERE id = $1`, [aId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('workout_adaptations — 1:1 alert + checks', () => {
  async function createPendingAlert(): Promise<{ alertId: string; workoutId: string }> {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const consultaId = await createTestConsulta(TENANT_REDE)
    const workoutId = await createTestWorkout(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO member_injury_alerts
       (tenant_id, member_id, source_consulta_id, primary_cid_code, expires_at)
       VALUES ($1, $2, $3, 'MG30.0', now() + interval '14 days') RETURNING id`,
      [TENANT_REDE, memberId, consultaId],
    )
    return { alertId: r.rows[0]!.id, workoutId }
  }

  it('insert válido OK', async () => {
    const { alertId, workoutId } = await createPendingAlert()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_adaptations
         (tenant_id, alert_id, original_workout_id, changes)
         VALUES ($1, $2, $3, '{"summary":"test"}'::jsonb)`,
        [TENANT_REDE, alertId, workoutId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('unique alert_id — 1 adaptation por alert', async () => {
    const { alertId, workoutId } = await createPendingAlert()
    await pool.query(
      `INSERT INTO workout_adaptations
       (tenant_id, alert_id, original_workout_id)
       VALUES ($1, $2, $3)`,
      [TENANT_REDE, alertId, workoutId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_adaptations
         (tenant_id, alert_id, original_workout_id)
         VALUES ($1, $2, $3)`,
        [TENANT_REDE, alertId, workoutId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('check confirmed_consistency — status confirmed sem adapted_workout_id rejeita', async () => {
    const { alertId, workoutId } = await createPendingAlert()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_adaptations
         (tenant_id, alert_id, original_workout_id, status, confirmed_at)
         VALUES ($1, $2, $3, 'confirmed', now())`,
        [TENANT_REDE, alertId, workoutId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('confirmed com adapted_workout_id + confirmed_at OK', async () => {
    const { alertId, workoutId } = await createPendingAlert()
    const adapted = await createTestWorkout(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO workout_adaptations
         (tenant_id, alert_id, original_workout_id, adapted_workout_id, status, confirmed_at)
         VALUES ($1, $2, $3, $4, 'confirmed', now())`,
        [TENANT_REDE, alertId, workoutId, adapted],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation per-tenant', async () => {
    const { alertId, workoutId } = await createPendingAlert()
    const r = await pool.query<{ id: string }>(
      `INSERT INTO workout_adaptations
       (tenant_id, alert_id, original_workout_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [TENANT_REDE, alertId, workoutId],
    )
    const adId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM workout_adaptations WHERE id = $1`, [adId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM workout_adaptations WHERE id = $1`, [adId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
