/**
 * Custos RLS + check constraints — Sprint 14 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em todas as 3 tabelas
 *   - Unique (tenant, slug) em cost_categories
 *   - Check cost_entries_amount_positive
 *   - Check recurring_costs_day_of_month_range (1-28)
 *   - Check recurring_costs_ends_after_starts
 *   - Soft-delete categorias via archived_at preserva row
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'
const FRANQ_COMPANY_ID = '00000002-0001-0000-0000-0000000000c1'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool
    .query('DELETE FROM cost_entries WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM recurring_costs WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM cost_categories WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM cost_entries WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM recurring_costs WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM cost_categories WHERE tenant_id IN ($1, $2)', [
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

describe('cost_categories — unique + isolamento', () => {
  it('slug duplicada no mesmo tenant rejeitada', async () => {
    await pool.query(
      `INSERT INTO cost_categories (tenant_id, slug, name, type)
       VALUES ($1, 'aluguel', 'Aluguel', 'fixed')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cost_categories (tenant_id, slug, name, type)
         VALUES ($1, 'aluguel', 'Aluguel Dup', 'fixed')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesma slug em outro tenant coexiste', async () => {
    await pool.query(
      `INSERT INTO cost_categories (tenant_id, slug, name, type)
       VALUES ($1, 'aluguel', 'Aluguel Rede', 'fixed')`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cost_categories (tenant_id, slug, name, type)
         VALUES ($1, 'aluguel', 'Aluguel Franq', 'fixed')`,
        [TENANT_FRANQUIA],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('tenant isolation — Rede vê suas; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cost_categories (tenant_id, slug, name, type)
       VALUES ($1, 'aluguel', 'Aluguel', 'fixed') RETURNING id`,
      [TENANT_REDE],
    )
    const cId = r.rows[0]!.id

    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM cost_categories WHERE id = $1', [
          cId,
        ])
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query<{ id: string }>('SELECT id FROM cost_categories WHERE id = $1', [
          cId,
        ])
        return x.rows
      }),
    ])
    expect(redeVisible.length).toBe(1)
    expect(franqVisible.length).toBe(0)
  })
})

describe('cost_entries — check amount + isolamento', () => {
  async function fresh(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cost_categories (tenant_id, slug, name, type)
       VALUES ($1, 'aluguel', 'Aluguel', 'fixed') RETURNING id`,
      [TENANT_REDE],
    )
    return r.rows[0]!.id
  }

  it('amount=0 rejeitado (positive)', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cost_entries (tenant_id, company_id, category_id, amount_cents, incurred_at)
         VALUES ($1, $2, $3, 0, '2026-05-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('amount negativo rejeitado', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO cost_entries (tenant_id, company_id, category_id, amount_cents, incurred_at)
         VALUES ($1, $2, $3, -100, '2026-05-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('insert válido + select isolado per-tenant', async () => {
    const cId = await fresh()
    await pool.query(
      `INSERT INTO cost_entries (tenant_id, company_id, category_id, amount_cents, incurred_at, description)
       VALUES ($1, $2, $3, 350000, '2026-05-05', 'Aluguel maio')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
    )
    const [redeRows, franqRows] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM cost_entries')
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM cost_entries')
        return x.rows
      }),
    ])
    expect(redeRows.length).toBeGreaterThanOrEqual(1)
    expect(franqRows.length).toBe(0)
  })
})

describe('recurring_costs — checks day_of_month + ends_after_starts', () => {
  async function fresh(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cost_categories (tenant_id, slug, name, type)
       VALUES ($1, 'aluguel', 'Aluguel', 'fixed') RETURNING id`,
      [TENANT_REDE],
    )
    return r.rows[0]!.id
  }

  it('day_of_month=0 rejeitado', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO recurring_costs (tenant_id, company_id, category_id, amount_cents, day_of_month, starts_at)
         VALUES ($1, $2, $3, 350000, 0, '2026-01-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('day_of_month=29 rejeitado (>28)', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO recurring_costs (tenant_id, company_id, category_id, amount_cents, day_of_month, starts_at)
         VALUES ($1, $2, $3, 350000, 29, '2026-01-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('ends_at antes de starts_at rejeitado', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO recurring_costs (tenant_id, company_id, category_id, amount_cents, day_of_month, starts_at, ends_at)
         VALUES ($1, $2, $3, 350000, 5, '2026-06-01', '2026-01-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('válido (day 5, ends_at NULL) aceito', async () => {
    const cId = await fresh()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO recurring_costs (tenant_id, company_id, category_id, amount_cents, day_of_month, starts_at)
         VALUES ($1, $2, $3, 350000, 5, '2026-01-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('soft-delete cost_categories via archived_at', () => {
  it('archived continua selectable pelo tenant', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO cost_categories (tenant_id, slug, name, type, archived_at)
       VALUES ($1, 'aluguel', 'Aluguel', 'fixed', now()) RETURNING id`,
      [TENANT_REDE],
    )
    const cId = r.rows[0]!.id
    const visible = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ archived_at: string | null }>(
        'SELECT archived_at FROM cost_categories WHERE id = $1',
        [cId],
      )
      return x.rows
    })
    expect(visible.length).toBe(1)
    expect(visible[0]!.archived_at).not.toBeNull()
  })
})
