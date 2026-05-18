/**
 * Nutri-Agent RLS + checks — Sprint 34 Faixa A.
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
     VALUES ($1, 'pf', 'Test NutriAgent Member', 'test-nutri-agent-' || $1::uuid::text || '@example.com') RETURNING id`,
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
  for (const t of ['nutri_agent_metrics_snapshot', 'nutri_agent_suggestions', 'nutri_agent_runs']) {
    await pool
      .query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool.end()
})

beforeEach(async () => {
  for (const t of ['nutri_agent_metrics_snapshot', 'nutri_agent_suggestions', 'nutri_agent_runs']) {
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

async function createRun(tenantId: string, memberId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO nutri_agent_runs (tenant_id, member_id, trigger, status)
     VALUES ($1, $2, 'manual_professional', 'queued') RETURNING id`,
    [tenantId, memberId],
  )
  return r.rows[0]!.id
}

describe('nutri_agent_runs — isolation + checks', () => {
  it('insert válido OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await createRun(TENANT_REDE, memberId)
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check completed_consistency: status=completed sem completed_at rejeita', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO nutri_agent_runs (tenant_id, member_id, trigger, status)
         VALUES ($1, $2, 'manual_professional', 'completed')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const runId = await createRun(TENANT_REDE, memberId)
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_runs WHERE id = $1`, [runId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_runs WHERE id = $1`, [runId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('nutri_agent_suggestions — checks + isolation', () => {
  async function insertSuggestion(
    tenantId: string,
    overrides: Partial<{
      status: string
      kind: string
      severity: string
      confidence: number
      reviewedByUser: boolean
    }> = {},
  ): Promise<string> {
    const memberId = await getOrCreateMember(tenantId)
    const runId = await createRun(tenantId, memberId)
    const reviewerCols = overrides.reviewedByUser
      ? `, reviewed_by_user_id, reviewed_at`
      : ''
    const reviewerVals = overrides.reviewedByUser
      ? `, (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1), now()`
      : ''
    const r = await pool.query<{ id: string }>(
      `INSERT INTO nutri_agent_suggestions
       (tenant_id, run_id, member_id, kind, severity, title, description, confidence, status, expires_at ${reviewerCols})
       VALUES ($1, $2, $3, $4::nutri_agent_suggestion_kind, $5::nutri_agent_suggestion_severity,
               'Test', 'Test desc', $6, $7::nutri_agent_suggestion_status,
               now() + interval '14 days' ${reviewerVals})
       RETURNING id`,
      [
        tenantId,
        runId,
        memberId,
        overrides.kind ?? 'alert',
        overrides.severity ?? 'info',
        overrides.confidence ?? 0.85,
        overrides.status ?? 'pending',
      ],
    )
    return r.rows[0]!.id
  }

  it('insert válido OK', async () => {
    let errCode = ''
    try {
      await insertSuggestion(TENANT_REDE)
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check confidence_range: 1.5 rejeita', async () => {
    let errCode = ''
    try {
      await insertSuggestion(TENANT_REDE, { confidence: 1.5 })
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check reviewed_consistency: status=accepted sem reviewed_by rejeita', async () => {
    let errCode = ''
    try {
      await insertSuggestion(TENANT_REDE, { status: 'accepted' })
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const sId = await insertSuggestion(TENANT_REDE)
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_suggestions WHERE id = $1`, [sId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_suggestions WHERE id = $1`, [sId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('nutri_agent_metrics_snapshot — append-only', () => {
  it('insert OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const runId = await createRun(TENANT_REDE, memberId)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO nutri_agent_metrics_snapshot
         (tenant_id, run_id, data, data_hash)
         VALUES ($1, $2, '{"meal_plan":null}'::jsonb, 'abc123')`,
        [TENANT_REDE, runId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation per-tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const runId = await createRun(TENANT_REDE, memberId)
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO nutri_agent_metrics_snapshot
       (tenant_id, run_id, data, data_hash)
       VALUES ($1, $2, '{"k":"v"}'::jsonb, 'hash1') RETURNING id`,
      [TENANT_REDE, runId],
    )
    const mId = ins.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_metrics_snapshot WHERE id = $1`, [mId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query(`SELECT id FROM nutri_agent_metrics_snapshot WHERE id = $1`, [mId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
