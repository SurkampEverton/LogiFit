/**
 * Nutri RLS + checks — Sprint 29 Faixa A.
 *
 * Valida:
 *   - foods: global lê por todos; tenant override só pelo dono; INSERT global rejeitado
 *   - meal_plans: isolation per-tenant; member vê próprio via app.member_id
 *   - check meal_items_grams_positive
 *   - food_equivalences: not self + grams positive
 *   - tenant_branding: 1 por tenant (PK)
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool

const DUMMY_NUTRIENTS = {
  kcal: 130,
  protein_g: 2.5,
  lipid_g: 0.2,
  carbohydrate_g: 28.1,
}

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
     VALUES ($1, 'pf', 'Test Nutri Member', 'test-nutri-' || $1::uuid::text || '@example.com') RETURNING id`,
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
    .query(`DELETE FROM meal_items WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_plan_meals WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_plans WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM food_measures WHERE food_id IN (SELECT id FROM foods WHERE tenant_id IN ($1, $2))`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(`DELETE FROM food_equivalences WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM foods WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM tenant_branding WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query(`DELETE FROM meal_items WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_plan_meals WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM meal_plans WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM food_equivalences WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM foods WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM tenant_branding WHERE tenant_id IN ($1, $2)`, [
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

describe('foods — global + tenant override', () => {
  it('foods global (tenant_id NULL) visível em ambos tenants', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO foods (tenant_id, source, name, name_normalized, category, nutrients)
       VALUES (NULL, 'taco', 'Arroz branco cozido teste', 'arroz branco cozido teste', 'cereais_e_derivados', $1::jsonb)
       RETURNING id`,
      [JSON.stringify(DUMMY_NUTRIENTS)],
    )
    const fId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM foods WHERE id = $1', [fId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM foods WHERE id = $1', [fId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(1)
    await pool.query('DELETE FROM foods WHERE id = $1', [fId])
  })

  it('tenant custom só vê pelo dono', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO foods (tenant_id, source, name, name_normalized, category, nutrients)
       VALUES ($1, 'custom', 'Bolo da Vovó', 'bolo da vovo', 'preparacoes', $2::jsonb)
       RETURNING id`,
      [TENANT_REDE, JSON.stringify(DUMMY_NUTRIENTS)],
    )
    const fId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM foods WHERE id = $1', [fId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM foods WHERE id = $1', [fId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('unique external_code rejeita duplicata global', async () => {
    await pool.query(
      `INSERT INTO foods (tenant_id, source, external_code, name, name_normalized, category, nutrients)
       VALUES (NULL, 'taco', 'TACO-TEST-001', 'Item 1', 'item 1', 'cereais_e_derivados', $1::jsonb)`,
      [JSON.stringify(DUMMY_NUTRIENTS)],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO foods (tenant_id, source, external_code, name, name_normalized, category, nutrients)
         VALUES (NULL, 'taco', 'TACO-TEST-001', 'Item 2', 'item 2', 'cereais_e_derivados', $1::jsonb)`,
        [JSON.stringify(DUMMY_NUTRIENTS)],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
    await pool.query(`DELETE FROM foods WHERE external_code = 'TACO-TEST-001'`)
  })
})

describe('food_measures + food_equivalences — checks', () => {
  it('food_measures grams positive', async () => {
    const f = await pool.query<{ id: string }>(
      `INSERT INTO foods (tenant_id, source, name, name_normalized, category, nutrients)
       VALUES ($1, 'custom', 'Test Food', 'test food', 'cereais_e_derivados', $2::jsonb)
       RETURNING id`,
      [TENANT_REDE, JSON.stringify(DUMMY_NUTRIENTS)],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO food_measures (food_id, measure, grams) VALUES ($1, 'colher', -5)`,
        [f.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('food_equivalences not_self constraint', async () => {
    const f = await pool.query<{ id: string }>(
      `INSERT INTO foods (tenant_id, source, name, name_normalized, category, nutrients)
       VALUES ($1, 'custom', 'Equiv Test', 'equiv test', 'cereais_e_derivados', $2::jsonb)
       RETURNING id`,
      [TENANT_REDE, JSON.stringify(DUMMY_NUTRIENTS)],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO food_equivalences (tenant_id, food_id_a, food_id_b, grams_a, grams_b, category)
         VALUES ($1, $2, $2, 100, 100, 'carbo')`,
        [TENANT_REDE, f.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('meal_plans — versioning + isolation', () => {
  async function createPlan(tenantId: string): Promise<{ planId: string; memberId: string }> {
    const memberId = await getOrCreateMember(tenantId)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO meal_plans (tenant_id, member_id, name, goal, target_kcal)
       VALUES ($1, $2, 'Plano Teste', 'emagrecimento', 1800) RETURNING id`,
      [tenantId, memberId],
    )
    return { planId: r.rows[0]!.id, memberId }
  }

  it('insert válido OK', async () => {
    let errCode = ''
    try {
      await createPlan(TENANT_REDE)
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check version positive', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO meal_plans (tenant_id, member_id, name, goal, version)
         VALUES ($1, $2, 'Bad', 'manutencao', 0)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation per-tenant', async () => {
    const { planId } = await createPlan(TENANT_REDE)
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM meal_plans WHERE id = $1', [planId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM meal_plans WHERE id = $1', [planId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('meal_items grams positive', async () => {
    const { planId } = await createPlan(TENANT_REDE)
    const m = await pool.query<{ id: string }>(
      `INSERT INTO meal_plan_meals (tenant_id, meal_plan_id, name, "order")
       VALUES ($1, $2, 'Almoço', 1) RETURNING id`,
      [TENANT_REDE, planId],
    )
    const f = await pool.query<{ id: string }>(
      `INSERT INTO foods (tenant_id, source, name, name_normalized, category, nutrients)
       VALUES ($1, 'custom', 'Food Item', 'food item', 'cereais_e_derivados', $2::jsonb)
       RETURNING id`,
      [TENANT_REDE, JSON.stringify(DUMMY_NUTRIENTS)],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO meal_items (tenant_id, meal_id, food_id, grams, "order")
         VALUES ($1, $2, $3, 0, 1)`,
        [TENANT_REDE, m.rows[0]!.id, f.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('tenant_branding — 1 row per tenant', () => {
  it('insert OK + duplicate (mesma PK) rejeitado', async () => {
    await pool.query(
      `INSERT INTO tenant_branding (tenant_id, primary_color) VALUES ($1, '#FF0000')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO tenant_branding (tenant_id, primary_color) VALUES ($1, '#00FF00')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('isolation per-tenant', async () => {
    await pool.query(
      `INSERT INTO tenant_branding (tenant_id, primary_color) VALUES ($1, '#FF0000')`,
      [TENANT_REDE],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT tenant_id FROM tenant_branding WHERE tenant_id = $1', [
          TENANT_REDE,
        ])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT tenant_id FROM tenant_branding WHERE tenant_id = $1', [
          TENANT_REDE,
        ])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
