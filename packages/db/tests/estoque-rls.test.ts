/**
 * Estoque RLS + checks — Sprint 24 Faixa A.
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
     VALUES ($1, 'pf', 'Test Stock', 'test-stock-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'stock-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of [
    'stock_inventory_entries',
    'stock_inventories',
    'stock_movements',
    'stock_items',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(`DELETE FROM users WHERE tenant_id IN ($1, $2) AND username LIKE 'stock-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'test-stock-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'stock_inventory_entries',
    'stock_inventories',
    'stock_movements',
    'stock_items',
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

describe('stock_items — unique SKU + isolation', () => {
  it('insert válido OK', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_items (tenant_id, company_id, sku, name, unit, cost_cents, min_stock, is_resale)
         VALUES ($1, $2, 'GAZE-100', 'Gaze 7.5x7.5cm 100un', 'pct', 500, 5, false)`,
        [TENANT_REDE, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('SKU duplicado por (tenant, company) rejeitado', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    await pool.query(
      `INSERT INTO stock_items (tenant_id, company_id, sku, name)
       VALUES ($1, $2, 'DUP-001', 'Item A')`,
      [TENANT_REDE, companyId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_items (tenant_id, company_id, sku, name)
         VALUES ($1, $2, 'DUP-001', 'Item B')`,
        [TENANT_REDE, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('min_stock negativo rejeitado', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_items (tenant_id, company_id, sku, name, min_stock)
         VALUES ($1, $2, 'NEG-001', 'Bad item', -5)`,
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
      `INSERT INTO stock_items (tenant_id, company_id, sku, name)
       VALUES ($1, $2, 'ISO-001', 'Iso item') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const iId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM stock_items WHERE id = $1', [iId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM stock_items WHERE id = $1', [iId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('stock_movements — append-only + checks', () => {
  async function createItem(): Promise<{ itemId: string; companyId: string }> {
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO stock_items (tenant_id, company_id, sku, name)
       VALUES ($1, $2, 'ITEM-MV-' || gen_random_uuid()::text, 'Item Mov') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    return { itemId: r.rows[0]!.id, companyId }
  }

  it('entry_purchase com unit_cost OK', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, unit_cost_cents, user_id, reference_doc)
         VALUES ($1, $2, $3, 'entry_purchase', 100, 500, $4, 'NF-001')`,
        [TENANT_REDE, companyId, itemId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('entry_purchase SEM unit_cost rejeitado', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, user_id)
         VALUES ($1, $2, $3, 'entry_purchase', 100, $4)`,
        [TENANT_REDE, companyId, itemId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('exit_consumption SEM unit_cost OK (não exige)', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, user_id)
         VALUES ($1, $2, $3, 'exit_consumption', 5, $4)`,
        [TENANT_REDE, companyId, itemId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('quantity 0 rejeitado', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, user_id, unit_cost_cents)
         VALUES ($1, $2, $3, 'entry_purchase', 0, $4, 500)`,
        [TENANT_REDE, companyId, itemId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('quantity negativa rejeitada', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, user_id)
         VALUES ($1, $2, $3, 'exit_loss', -10, $4)`,
        [TENANT_REDE, companyId, itemId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('UPDATE rejeitado (append-only)', async () => {
    const { itemId, companyId } = await createItem()
    const userId = await getUser(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO stock_movements (tenant_id, company_id, item_id, kind, quantity, unit_cost_cents, user_id)
       VALUES ($1, $2, $3, 'entry_purchase', 50, 500, $4) RETURNING id`,
      [TENANT_REDE, companyId, itemId, userId],
    )
    let errCode = ''
    let updateCount = 0
    try {
      const updateResult = await withTenantContext(TENANT_REDE, async (c) => {
        return c.query(`UPDATE stock_movements SET notes = 'editado' WHERE id = $1`, [r.rows[0]!.id])
      })
      updateCount = updateResult.rowCount ?? 0
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    // Esperado: ou erro 42501 (sem permission) ou 0 rows updated (sem policy UPDATE)
    expect(errCode === '42501' || updateCount === 0).toBe(true)
    // Verifica que notes não mudou
    const after = await pool.query<{ notes: string | null }>(
      `SELECT notes FROM stock_movements WHERE id = $1`,
      [r.rows[0]!.id],
    )
    expect(after.rows[0]!.notes).toBeNull()
  })
})

describe('stock_inventory_entries — CHECK difference', () => {
  it('difference inconsistente rejeitado', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const item = await pool.query<{ id: string }>(
      `INSERT INTO stock_items (tenant_id, company_id, sku, name)
       VALUES ($1, $2, 'INV-CHK-001', 'Item check') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const inv = await pool.query<{ id: string }>(
      `INSERT INTO stock_inventories (tenant_id, company_id, counted_by_user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [TENANT_REDE, companyId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_inventory_entries (inventory_id, item_id, system_qty, physical_qty, difference)
         VALUES ($1, $2, 100, 95, 999)`,
        [inv.rows[0]!.id, item.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('difference consistente aceito', async () => {
    const companyId = await getMatriz(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const item = await pool.query<{ id: string }>(
      `INSERT INTO stock_items (tenant_id, company_id, sku, name)
       VALUES ($1, $2, 'INV-OK-001', 'Item ok') RETURNING id`,
      [TENANT_REDE, companyId],
    )
    const inv = await pool.query<{ id: string }>(
      `INSERT INTO stock_inventories (tenant_id, company_id, counted_by_user_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [TENANT_REDE, companyId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO stock_inventory_entries (inventory_id, item_id, system_qty, physical_qty, difference)
         VALUES ($1, $2, 100, 95, -5)`,
        [inv.rows[0]!.id, item.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})
