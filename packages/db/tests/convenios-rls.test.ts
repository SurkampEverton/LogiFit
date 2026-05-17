/**
 * TISS/TUSS + Convênios RLS + constraints — Sprint 22 Faixa A.
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

let pool: Pool
let UNIMED_PLAN_ID: string
let BRADESCO_PLAN_ID: string

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
     VALUES ($1, 'pf', 'Test Conv', 'test-conv-' || $1::uuid::text || '@example.com') RETURNING id`,
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
  // Seed mínimo TUSS + planos globais
  await pool.query(`
    INSERT INTO tuss_catalog (code, description, category, version, specialties) VALUES
      ('20104073', 'Sessão de fisioterapia individual', 'procedimento', '2026.01', ARRAY['fisioterapia']),
      ('10101012', 'Consulta médica em consultório', 'procedimento', '2026.01', ARRAY['medicina'])
    ON CONFLICT DO NOTHING
  `)
  // Insurance plans globais (idempotente: deleta + insere)
  await pool.query(`DELETE FROM insurance_plans WHERE ans_code IN ('TEST-UNI-001', 'TEST-BRA-001')`)
  const unimed = await pool.query<{ id: string }>(
    `INSERT INTO insurance_plans (name, ans_code, tiss_version, national, active)
     VALUES ('Unimed Test', 'TEST-UNI-001', '4.01', true, true)
     RETURNING id`,
  )
  const bradesco = await pool.query<{ id: string }>(
    `INSERT INTO insurance_plans (name, ans_code, tiss_version, national, active)
     VALUES ('Bradesco Saude Test', 'TEST-BRA-001', '4.01', true, true)
     RETURNING id`,
  )
  UNIMED_PLAN_ID = unimed.rows[0]!.id
  BRADESCO_PLAN_ID = bradesco.rows[0]!.id
})

afterAll(async () => {
  for (const tbl of [
    'billing_glosas',
    'billing_guide_items',
    'billing_guides',
    'billing_batches',
    'authorizations',
    'member_insurances',
    'insurance_procedure_prices',
    'insurance_agreements',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(
      `DELETE FROM members WHERE tenant_id IN ($1, $2) AND person_id IN (SELECT id FROM persons WHERE email LIKE 'test-conv-%')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(`DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'test-conv-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  // Clean test plans
  await pool
    .query(`DELETE FROM insurance_plans WHERE ans_code LIKE 'TEST-%'`)
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'billing_glosas',
    'billing_guide_items',
    'billing_guides',
    'billing_batches',
    'authorizations',
    'member_insurances',
    'insurance_procedure_prices',
    'insurance_agreements',
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

describe('tuss_catalog + insurance_plans — read-all global', () => {
  it('todo tenant lê TUSS', async () => {
    const r = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tuss_catalog`)
      return Number(x.rows[0]!.count)
    })
    expect(r).toBeGreaterThanOrEqual(2)
  })

  it('todo tenant lê insurance_plans globais', async () => {
    const r = await withTenantContext(TENANT_FRANQUIA, async (c) => {
      const x = await c.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM insurance_plans WHERE ans_code LIKE 'TEST-%'`,
      )
      return Number(x.rows[0]!.count)
    })
    expect(r).toBeGreaterThanOrEqual(2)
  })
})

describe('insurance_agreements — isolation', () => {
  it('agreement do tenant Rede invisível pra Franquia', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO insurance_agreements (tenant_id, company_id, plan_id, effective_from, contract_number)
       VALUES ($1, $2, $3, '2026-01-01', 'CTR-001') RETURNING id`,
      [TENANT_REDE, companyId, UNIMED_PLAN_ID],
    )
    const aId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM insurance_agreements WHERE id = $1', [aId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM insurance_agreements WHERE id = $1', [aId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('insurance_procedure_prices — herda RLS via JOIN', () => {
  it('price visible via tenant; check price >= 0', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const ag = await pool.query<{ id: string }>(
      `INSERT INTO insurance_agreements (tenant_id, company_id, plan_id, effective_from)
       VALUES ($1, $2, $3, '2026-01-01') RETURNING id`,
      [TENANT_REDE, companyId, BRADESCO_PLAN_ID],
    )
    let errCode = ''
    try {
      await withTenantContext(TENANT_REDE, async (c) => {
        await c.query(
          `INSERT INTO insurance_procedure_prices (agreement_id, tuss_code, price_cents, auth_required, max_sessions_per_auth)
           VALUES ($1, '20104073', 5500, true, 10)`,
          [ag.rows[0]!.id],
        )
      })
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')

    // Check price negativo bloqueado
    let neg = ''
    try {
      await withTenantContext(TENANT_REDE, async (c) => {
        await c.query(
          `INSERT INTO insurance_procedure_prices (agreement_id, tuss_code, price_cents)
           VALUES ($1, '10101012', -100)`,
          [ag.rows[0]!.id],
        )
      })
    } catch (err) {
      neg = (err as { code?: string }).code ?? ''
    }
    expect(neg).toBe('23514')
  })
})

describe('authorizations — checks', () => {
  it('quantity_used > quantity_authorized rejeitado por check', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-123') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO authorizations (tenant_id, member_insurance_id, tuss_code, quantity_requested, quantity_authorized, quantity_used)
         VALUES ($1, $2, '20104073', 10, 8, 12)`,
        [TENANT_REDE, mi.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('quantity_used = quantity_authorized aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-EQ') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO authorizations (tenant_id, member_insurance_id, tuss_code, quantity_requested, quantity_authorized, quantity_used)
         VALUES ($1, $2, '20104073', 10, 8, 8)`,
        [TENANT_REDE, mi.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('billing_guides + items — checks', () => {
  it('insert guide draft + items consistentes', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-BG') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    const g = await pool.query<{ id: string }>(
      `INSERT INTO billing_guides (tenant_id, company_id, member_id, member_insurance_id, kind, guide_number, total_cents, tuss_version)
       VALUES ($1, $2, $3, $4, 'sp_sadt', 'GUI-001', 11000, '2026.01') RETURNING id`,
      [TENANT_REDE, companyId, memberId, mi.rows[0]!.id],
    )
    const userR = await pool.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)
    if (!userR.rows[0]) return

    // Item consistente: 2 × 5500 = 11000
    let ok = ''
    try {
      await pool.query(
        `INSERT INTO billing_guide_items (tenant_id, guide_id, sequence_number, tuss_code, description, quantity, unit_price_cents, total_cents, professional_user_id, cbos_code)
         VALUES ($1, $2, 1, '20104073', 'Sessao fisio', 2, 5500, 11000, $3, '226305')`,
        [TENANT_REDE, g.rows[0]!.id, userR.rows[0]!.id],
      )
    } catch (err) {
      ok = (err as { code?: string }).code ?? ''
    }
    expect(ok).toBe('')

    // Item inconsistente: 2 × 5500 ≠ 12000 (check `total = quantity * unit_price`)
    let bad = ''
    try {
      await pool.query(
        `INSERT INTO billing_guide_items (tenant_id, guide_id, sequence_number, tuss_code, description, quantity, unit_price_cents, total_cents, professional_user_id)
         VALUES ($1, $2, 2, '10101012', 'Consulta', 2, 5500, 12000, $3)`,
        [TENANT_REDE, g.rows[0]!.id, userR.rows[0]!.id],
      )
    } catch (err) {
      bad = (err as { code?: string }).code ?? ''
    }
    expect(bad).toBe('23514')
  })

  it('paid_amount > total bloqueado por check', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-PAID') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO billing_guides (tenant_id, company_id, member_id, member_insurance_id, kind, guide_number, total_cents, paid_amount_cents, tuss_version)
         VALUES ($1, $2, $3, $4, 'consulta', 'GUI-PAID-OVER', 10000, 99999, '2026.01')`,
        [TENANT_REDE, companyId, memberId, mi.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('unique guide_number por tenant', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-UQ') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    await pool.query(
      `INSERT INTO billing_guides (tenant_id, company_id, member_id, member_insurance_id, kind, guide_number, total_cents, tuss_version)
       VALUES ($1, $2, $3, $4, 'consulta', 'GUI-UQ-001', 10000, '2026.01')`,
      [TENANT_REDE, companyId, memberId, mi.rows[0]!.id],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO billing_guides (tenant_id, company_id, member_id, member_insurance_id, kind, guide_number, total_cents, tuss_version)
         VALUES ($1, $2, $3, $4, 'consulta', 'GUI-UQ-001', 5000, '2026.01')`,
        [TENANT_REDE, companyId, memberId, mi.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('billing_glosas — check amount > 0', () => {
  it('glosa com amount 0 bloqueada', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO member_insurances (tenant_id, member_id, plan_id, card_number)
       VALUES ($1, $2, $3, 'CARD-GL') RETURNING id`,
      [TENANT_REDE, memberId, UNIMED_PLAN_ID],
    )
    const g = await pool.query<{ id: string }>(
      `INSERT INTO billing_guides (tenant_id, company_id, member_id, member_insurance_id, kind, guide_number, total_cents, tuss_version)
       VALUES ($1, $2, $3, $4, 'sp_sadt', 'GUI-GLOSA', 11000, '2026.01') RETURNING id`,
      [TENANT_REDE, companyId, memberId, mi.rows[0]!.id],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO billing_glosas (tenant_id, guide_id, reason_code, reason_description, amount_glossed_cents)
         VALUES ($1, $2, '0301', 'Procedimento sem cobertura', 0)`,
        [TENANT_REDE, g.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})
