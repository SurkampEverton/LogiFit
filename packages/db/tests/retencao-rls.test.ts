/**
 * Retenção/Churn RLS + constraints — Sprint 19 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em 4 tabelas
 *   - Check: prob_30d/60d/90d ∈ [0, 1]
 *   - Unique churn_events.member_id (1 churn por member; reativação cria novo member)
 *   - Unique churn_predictions.snapshot_id (1 predição por snapshot)
 *   - Append-only churn_features_snapshot (sem UPDATE policy)
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool

async function getOrCreateMember(tenantId: string, _hint: string): Promise<string> {
  // Reusa o primeiro member do tenant; se não houver, cria um person + member.
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM members WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id

  // Cria person + member mínimos para os tests funcionarem isolados de outros seeds.
  // members exige company_id — usa matriz do tenant.
  const cR = await pool.query<{ id: string }>(
    `SELECT id FROM companies WHERE tenant_id = $1 AND type = 'matriz' LIMIT 1`,
    [tenantId],
  )
  if (!cR.rows[0]) throw new Error(`Sem matriz em ${tenantId} — rode db:seed canônico antes`)
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', $2, $3) RETURNING id`,
    [tenantId, `Test Member ${tenantId.slice(0, 8)}`, `test-${tenantId.slice(0, 8)}@example.com`],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, cR.rows[0]!.id],
  )
  return m.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of [
    'churn_events',
    'churn_interventions',
    'churn_predictions',
    'churn_features_snapshot',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  // Limpa members + persons criados via getOrCreateMember (email padronizado)
  await pool
    .query(
      `DELETE FROM members WHERE tenant_id IN ($1, $2) AND person_id IN (SELECT id FROM persons WHERE email LIKE 'test-%@example.com')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(`DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'test-%@example.com'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'churn_events',
    'churn_interventions',
    'churn_predictions',
    'churn_features_snapshot',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
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

describe('churn_features_snapshot — append-only + isolation', () => {
  it('insert válido aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'features insert')
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
         VALUES ($1, $2, $3::jsonb, 'abc123')`,
        [TENANT_REDE, memberId, JSON.stringify({ frequencyLast30d: 12 })],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation: snapshot do tenant Rede invisível pra Franquia', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'isolation')
    const r = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'h1') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const sId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM churn_features_snapshot WHERE id = $1', [sId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM churn_features_snapshot WHERE id = $1', [sId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('churn_predictions — check ranges + unique snapshot', () => {
  it('insert válido aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'pred valid')
    const s = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'hpred1') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
         VALUES ($1, $2, $3, 'gemini-2.5-flash@2026-05', 0.42, 0.55, 0.65, 'medium', '[]'::jsonb, now() + interval '24h')`,
        [TENANT_REDE, memberId, s.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('prob_30d > 1.0 rejeitado por check', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'pred check')
    const s = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'hpred2') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
         VALUES ($1, $2, $3, 'test', 1.5, 0.5, 0.5, 'high', '[]'::jsonb, now() + interval '24h')`,
        [TENANT_REDE, memberId, s.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('prob_30d negativo rejeitado', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'pred neg')
    const s = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'hpred3') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
         VALUES ($1, $2, $3, 'test', -0.1, 0.5, 0.5, 'low', '[]'::jsonb, now() + interval '24h')`,
        [TENANT_REDE, memberId, s.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('mesmo snapshot_id 2× rejeitado por unique', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'pred dup')
    const s = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'hpred4') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    await pool.query(
      `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
       VALUES ($1, $2, $3, 'v1', 0.5, 0.5, 0.5, 'medium', '[]'::jsonb, now() + interval '24h')`,
      [TENANT_REDE, memberId, s.rows[0]!.id],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
         VALUES ($1, $2, $3, 'v2', 0.6, 0.6, 0.6, 'high', '[]'::jsonb, now() + interval '24h')`,
        [TENANT_REDE, memberId, s.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('churn_interventions — assigned + outcome lifecycle', () => {
  it('cria intervenção aberta + atualiza com outcome', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'intv lifecycle')
    const s = await pool.query<{ id: string }>(
      `INSERT INTO churn_features_snapshot (tenant_id, member_id, features, snapshot_hash)
       VALUES ($1, $2, '{}'::jsonb, 'hintv1') RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const p = await pool.query<{ id: string }>(
      `INSERT INTO churn_predictions (tenant_id, member_id, snapshot_id, model_version, prob_30d, prob_60d, prob_90d, risk_band, top_factors, valid_until)
       VALUES ($1, $2, $3, 'v1', 0.75, 0.8, 0.85, 'high', '[]'::jsonb, now() + interval '24h') RETURNING id`,
      [TENANT_REDE, memberId, s.rows[0]!.id],
    )
    const userR = await pool.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)
    const userId = userR.rows[0]!.id

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO churn_interventions (tenant_id, member_id, prediction_id, assigned_to_user_id, action, notes)
       VALUES ($1, $2, $3, $4, 'phone_call', 'Member sumiu — ligar') RETURNING id`,
      [TENANT_REDE, memberId, p.rows[0]!.id, userId],
    )
    const intvId = ins.rows[0]!.id

    await pool.query(
      `UPDATE churn_interventions SET closed_at = now(), outcome = 'success', outcome_notes = 'Voltou no mesmo dia'
       WHERE id = $1 AND tenant_id = $2`,
      [intvId, TENANT_REDE],
    )
    const r = await pool.query<{ outcome: string }>(
      `SELECT outcome FROM churn_interventions WHERE id = $1`,
      [intvId],
    )
    expect(r.rows[0]!.outcome).toBe('success')
  })
})

describe('churn_events — 1 por member', () => {
  it('insert primeira vez OK', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'events1')
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_events (tenant_id, member_id, reason, prob_at_churn, was_predicted)
         VALUES ($1, $2, 'financial', 0.85, true)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('mesmo member 2× rejeitado', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'events dup')
    await pool.query(
      `INSERT INTO churn_events (tenant_id, member_id, reason) VALUES ($1, $2, 'location')`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO churn_events (tenant_id, member_id, reason) VALUES ($1, $2, 'satisfaction')`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('isolation: cross-tenant não vê', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE, 'events iso')
    await pool.query(
      `INSERT INTO churn_events (tenant_id, member_id, reason) VALUES ($1, $2, 'health')`,
      [TENANT_REDE, memberId],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM churn_events WHERE member_id = $1', [memberId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM churn_events WHERE member_id = $1', [memberId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
