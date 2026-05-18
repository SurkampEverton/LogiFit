/**
 * Vigilância (ANVISA + Limpeza) RLS + checks — Sprint 25 Faixa A.
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

async function getUser(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Vig User', 'test-vig-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'vig-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of [
    'cleaning_logs',
    'cleaning_checklists',
    'equipment_usage_log',
    'equipment_maintenance',
    'equipment',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(`DELETE FROM users WHERE tenant_id IN ($1, $2) AND username LIKE 'vig-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'test-vig-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'cleaning_logs',
    'cleaning_checklists',
    'equipment_usage_log',
    'equipment_maintenance',
    'equipment',
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

describe('equipment — unique serial global + isolation', () => {
  it('insert válido OK', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
         VALUES ($1, $2, 'ultrassom', 'Bioset', 'Sonopulse 3', 'SN-001', '2026-01-15')`,
        [TENANT_REDE, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('serial duplicado em mesmo manufacturer rejeitado globalmente', async () => {
    const companyA = await getMatriz(TENANT_REDE)
    const companyB = await getMatriz(TENANT_FRANQUIA)
    await pool.query(
      `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
       VALUES ($1, $2, 'tens', 'IBRAMED', 'NeuroDyn', 'GLOBAL-001', '2026-01-15')`,
      [TENANT_REDE, companyA],
    )
    let errCode = ''
    try {
      // Mesmo serial+manufacturer em OUTRO tenant = bloqueado
      await pool.query(
        `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
         VALUES ($1, $2, 'tens', 'IBRAMED', 'NeuroDyn', 'GLOBAL-001', '2026-02-15')`,
        [TENANT_FRANQUIA, companyB],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('intervals negativos rejeitados', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at, maintenance_interval_days)
         VALUES ($1, $2, 'laser', 'MMO', 'L3', 'SN-NEG', '2026-01-15', -30)`,
        [TENANT_REDE, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
       VALUES ($1, $2, 'crioterapia', 'Cryo Inc', 'Cryo X', 'SN-ISO', '2026-01-15') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const eId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM equipment WHERE id = $1', [eId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM equipment WHERE id = $1', [eId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('equipment_maintenance — checks', () => {
  async function createEquipment(): Promise<string> {
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
       VALUES ($1, $2, 'tens', 'IBRAMED', 'NeuroDyn', 'SN-MNT-' || gen_random_uuid()::text, '2026-01-15') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    return r.rows[0]!.id
  }

  it('scheduled OK', async () => {
    const eqId = await createEquipment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment_maintenance (tenant_id, equipment_id, kind, planned_for, status)
         VALUES ($1, $2, 'preventive', '2026-07-15', 'scheduled')`,
        [TENANT_REDE, eqId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('completed sem performed_at rejeitado', async () => {
    const eqId = await createEquipment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment_maintenance (tenant_id, equipment_id, kind, planned_for, status)
         VALUES ($1, $2, 'calibration', '2026-07-15', 'completed')`,
        [TENANT_REDE, eqId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('external_location=true sem supplier rejeitado', async () => {
    const eqId = await createEquipment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment_maintenance (tenant_id, equipment_id, kind, planned_for, external_location)
         VALUES ($1, $2, 'calibration', '2026-07-15', true)`,
        [TENANT_REDE, eqId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('external_location=true com supplier OK', async () => {
    const eqId = await createEquipment()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment_maintenance (tenant_id, equipment_id, kind, planned_for, external_location, external_supplier_id)
         VALUES ($1, $2, 'calibration', '2026-07-15', true, gen_random_uuid())`,
        [TENANT_REDE, eqId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('equipment_usage_log — append-only', () => {
  it('insert OK + UPDATE bloqueado', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const eq = await pool.query<{ id: string }>(
      `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
       VALUES ($1, $2, 'laser', 'MMO', 'L4', 'SN-USE-' || gen_random_uuid()::text, '2026-01-15') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO equipment_usage_log (tenant_id, equipment_id, used_by_user_id, duration_minutes)
       VALUES ($1, $2, $3, 15) RETURNING id`,
      [TENANT_REDE, eq.rows[0]!.id, userId],
    )
    // UPDATE rejeitado pelo logifit_app (sem policy)
    let updateCount = 0
    try {
      const r = await withTenantContext(TENANT_REDE, async (c) => {
        return c.query(`UPDATE equipment_usage_log SET notes = 'editado' WHERE id = $1`, [
          ins.rows[0]!.id,
        ])
      })
      updateCount = r.rowCount ?? 0
    } catch {
      /* ignore */
    }
    expect(updateCount).toBe(0)
  })

  it('duration negativa rejeitada', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const eq = await pool.query<{ id: string }>(
      `INSERT INTO equipment (tenant_id, company_id, kind, manufacturer, model, serial_number, acquired_at)
       VALUES ($1, $2, 'tens', 'IBRAMED', 'X', 'SN-DUR-' || gen_random_uuid()::text, '2026-01-15') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO equipment_usage_log (tenant_id, equipment_id, used_by_user_id, duration_minutes)
         VALUES ($1, $2, $3, -5)`,
        [TENANT_REDE, eq.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('cleaning_logs — completion_pct range + append-only', () => {
  async function createChecklist(): Promise<string> {
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cleaning_checklists (tenant_id, company_id, name, items, frequency_days)
       VALUES ($1, $2, 'Limpeza Sala Fisio', '[{"key":"alcool","label":"Álcool 70%","required":true}]'::jsonb, 1)
       RETURNING id`,
      [TENANT_REDE, companyId],
    )
    return r.rows[0]!.id
  }

  it('insert OK', async () => {
    const checklistId = await createChecklist()
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cleaning_logs (tenant_id, company_id, checklist_id, performed_by_user_id, items_done, completion_pct, is_complete)
         VALUES ($1, $2, $3, $4, '["alcool"]'::jsonb, 100, true)`,
        [TENANT_REDE, companyId, checklistId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('completion_pct 150 rejeitado', async () => {
    const checklistId = await createChecklist()
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cleaning_logs (tenant_id, company_id, checklist_id, performed_by_user_id, items_done, completion_pct)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, 150)`,
        [TENANT_REDE, companyId, checklistId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('checklist frequency 0 rejeitado', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cleaning_checklists (tenant_id, company_id, name, items, frequency_days)
         VALUES ($1, $2, 'Bad', '[]'::jsonb, 0)`,
        [TENANT_REDE, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})
