/**
 * Adquirência RLS + constraints — Sprint 18 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em 4 tabelas
 *   - Unique (provider, merchant_id) em acquirer_connections
 *   - Unique (connection_id, external_id) em acquirer_sales
 *   - Unique (tenant_id, name) em acquirer_reconciliation_rules
 *   - Check: net = gross - fee em acquirer_sales
 *   - Check: installments [1, 24]
 *   - Check: gross > 0 em acquirer_sales / original > 0 em anticipations
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
  for (const tbl of [
    'anticipations',
    'acquirer_sales',
    'acquirer_reconciliation_rules',
    'acquirer_connections',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'anticipations',
    'acquirer_sales',
    'acquirer_reconciliation_rules',
    'acquirer_connections',
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

describe('acquirer_connections — unique + isolation', () => {
  it('insert válido aceito', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id, nickname, sandbox, status)
         VALUES ($1, $2, 'stone', 'STONE-MERCHANT-001', 'Stone Matriz', true, 'active')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('duplicata (provider, merchant_id) rejeitada — escopo global', async () => {
    await pool.query(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-GLOBAL-DUP')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      // Mesmo merchant_id em OUTRO tenant: bloqueado (merchant_id é único no provider).
      await pool.query(
        `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
         VALUES ($1, $2, 'stone', 'STONE-GLOBAL-DUP')`,
        [TENANT_FRANQUIA, FRANQ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesmo merchant em providers diferentes coexiste', async () => {
    await pool.query(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'MERCHANT-XYZ')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
         VALUES ($1, $2, 'cielo', 'MERCHANT-XYZ')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-ISO-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM acquirer_connections WHERE id = $1', [cId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM acquirer_connections WHERE id = $1', [cId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('acquirer_sales — unique external_id + checks', () => {
  it('mesma external_id na mesma connection rejeitada', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-SALES-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const cId = r.rows[0]!.id
    await pool.query(
      `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
       VALUES ($1, $2, $3, 'NSU-100', now(), 10000, 350, 9650, '2026-06-01')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
         VALUES ($1, $2, $3, 'NSU-100', now(), 5000, 200, 4800, '2026-06-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesma external_id em connection diferente coexiste', async () => {
    const r1 = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-DUAL-A') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const r2 = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'cielo', 'CIELO-DUAL-B') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
         VALUES ($1, $2, $3, 'NSU-DUAL', now(), 10000, 350, 9650, '2026-06-01'),
                ($1, $2, $4, 'NSU-DUAL', now(), 10000, 350, 9650, '2026-06-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r1.rows[0]!.id, r2.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('check: net = gross - fee (consistência)', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-CHK-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
         VALUES ($1, $2, $3, 'NSU-INCONSISTENT', now(), 10000, 350, 9999, '2026-06-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514') // check_violation
  })

  it('check: installments fora de [1, 24] rejeitado', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-INST-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date, installments)
         VALUES ($1, $2, $3, 'NSU-INST-25', now(), 10000, 350, 9650, '2026-06-01', 25)`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('check: gross_amount = 0 rejeitado', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-ZERO-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
         VALUES ($1, $2, $3, 'NSU-ZERO', now(), 0, 0, 0, '2026-06-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation: Rede vê venda; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-ISO-SAL') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const s = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_sales (tenant_id, company_id, connection_id, external_id, captured_at, gross_amount_cents, fee_cents, net_amount_cents, expected_settlement_date)
       VALUES ($1, $2, $3, 'NSU-ISO', now(), 10000, 350, 9650, '2026-06-01') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r.rows[0]!.id],
    )
    const sId = s.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM acquirer_sales WHERE id = $1', [sId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM acquirer_sales WHERE id = $1', [sId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('anticipations — check + isolation', () => {
  it('check: original_amount = 0 rejeitado', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-ANTIC-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO anticipations (tenant_id, connection_id, company_id, sales_ids, original_amount_cents)
         VALUES ($1, $2, $3, ARRAY[]::uuid[], 0)`,
        [TENANT_REDE, r.rows[0]!.id, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation: anticipation visible apenas no tenant', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO acquirer_connections (tenant_id, company_id, provider, merchant_id)
       VALUES ($1, $2, 'stone', 'STONE-ANTIC-ISO') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const a = await pool.query<{ id: string }>(
      `INSERT INTO anticipations (tenant_id, connection_id, company_id, sales_ids, original_amount_cents)
       VALUES ($1, $2, $3, ARRAY[]::uuid[], 100000) RETURNING id`,
      [TENANT_REDE, r.rows[0]!.id, REDE_MATRIZ_COMPANY_ID],
    )
    const aId = a.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM anticipations WHERE id = $1', [aId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM anticipations WHERE id = $1', [aId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('acquirer_reconciliation_rules — unique name', () => {
  it('name duplicado no mesmo tenant rejeitado', async () => {
    await pool.query(
      `INSERT INTO acquirer_reconciliation_rules (tenant_id, name, condition, action)
       VALUES ($1, 'Match Stone settlement', $2::jsonb, 'auto_match_bank')`,
      [TENANT_REDE, JSON.stringify({ providerEquals: 'stone' })],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_reconciliation_rules (tenant_id, name, condition, action)
         VALUES ($1, 'Match Stone settlement', $2::jsonb, 'auto_match_bank')`,
        [TENANT_REDE, JSON.stringify({ providerEquals: 'stone', cardBrandEquals: 'visa' })],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesmo name em tenants diferentes aceito', async () => {
    await pool.query(
      `INSERT INTO acquirer_reconciliation_rules (tenant_id, name, condition, action)
       VALUES ($1, 'Match default', $2::jsonb, 'auto_match_bank')`,
      [TENANT_REDE, JSON.stringify({ providerEquals: 'stone' })],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO acquirer_reconciliation_rules (tenant_id, name, condition, action)
         VALUES ($1, 'Match default', $2::jsonb, 'auto_match_bank')`,
        [TENANT_FRANQUIA, JSON.stringify({ providerEquals: 'cielo' })],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})
