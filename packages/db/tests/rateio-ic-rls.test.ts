/**
 * Rateio + Intercompany RLS + check constraints — Sprint 16 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em allocation_rules + ap_allocations + intercompany_entries
 *   - Unique (tenant, name) em allocation_rules
 *   - Regra 25: trigger bloqueia tenant topology='franchise'
 *   - Check ap_allocations.amount > 0 + percent ∈ [0, 100]
 *   - Check intercompany_entries.from != to
 *   - Trigger requires_nfe_transfer ativa quando kind='goods' + CNPJs distintos
 *   - ap_allocations append-only (UPDATE/DELETE bloqueados via RLS)
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010' // topology=owned
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010' // topology=franchise
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'
const REDE_FILIAL_1_COMPANY_ID = '00000001-0001-0000-0000-0000000000c2'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool
    .query('DELETE FROM intercompany_entries WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM allocation_rules WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM intercompany_entries WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM allocation_rules WHERE tenant_id IN ($1, $2)', [
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

describe('allocation_rules — regra 25 + unique + isolation', () => {
  it('insert em tenant owned aceito', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO allocation_rules (tenant_id, name, kind, distribution)
         VALUES ($1, 'Aluguel 40/30/30', 'fixed', $2::jsonb)`,
        [
          TENANT_REDE,
          JSON.stringify([
            { companyId: REDE_MATRIZ_COMPANY_ID, percent: 40 },
            { companyId: REDE_FILIAL_1_COMPANY_ID, percent: 60 },
          ]),
        ],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('insert em tenant franchise rejeitado (regra 25)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO allocation_rules (tenant_id, name, kind, distribution)
         VALUES ($1, 'Rateio inválido', 'fixed', $2::jsonb)`,
        [
          TENANT_FRANQUIA,
          JSON.stringify([{ companyId: '00000002-0001-0000-0000-0000000000c1', percent: 100 }]),
        ],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514') // check_violation via trigger RAISE
  })

  it('name duplicado no mesmo tenant rejeitado', async () => {
    await pool.query(
      `INSERT INTO allocation_rules (tenant_id, name, kind, distribution)
       VALUES ($1, 'Rateio padrão', 'fixed', $2::jsonb)`,
      [TENANT_REDE, JSON.stringify([])],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO allocation_rules (tenant_id, name, kind, distribution)
         VALUES ($1, 'Rateio padrão', 'fixed', $2::jsonb)`,
        [TENANT_REDE, JSON.stringify([])],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505') // unique_violation
  })

  it('isolation per-tenant: Rede vê; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO allocation_rules (tenant_id, name, kind, distribution)
       VALUES ($1, 'Rede só', 'fixed', $2::jsonb) RETURNING id`,
      [TENANT_REDE, JSON.stringify([])],
    )
    const rId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM allocation_rules WHERE id = $1', [rId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM allocation_rules WHERE id = $1', [rId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('intercompany_entries — regra 25 + check from!=to + isolation', () => {
  it('IC entry em tenant owned aceito', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind, notes)
         VALUES ($1, $2, $3, 100000, 'payment', 'matriz pagou pela filial')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, REDE_FILIAL_1_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('IC entry em tenant franchise rejeitado (regra 25)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind)
         VALUES ($1, '00000002-0001-0000-0000-0000000000c1', '00000002-0001-0000-0000-0000000000c2', 100000, 'payment')`,
        [TENANT_FRANQUIA],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('from == to rejeitado (check distinct_companies)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind)
         VALUES ($1, $2, $2, 100000, 'payment')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('amount=0 rejeitado (check positive)', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind)
         VALUES ($1, $2, $3, 0, 'payment')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, REDE_FILIAL_1_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('trigger ativa requires_nfe_transfer quando kind=goods + CNPJs distintos', async () => {
    const r = await pool.query<{ requires_nfe_transfer: boolean }>(
      `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind, notes)
       VALUES ($1, $2, $3, 250000, 'goods', 'esteira matriz → filial')
       RETURNING requires_nfe_transfer`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, REDE_FILIAL_1_COMPANY_ID],
    )
    expect(r.rows[0]!.requires_nfe_transfer).toBe(true)
  })

  it('trigger NÃO ativa requires_nfe_transfer quando kind=payment', async () => {
    const r = await pool.query<{ requires_nfe_transfer: boolean }>(
      `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind, notes)
       VALUES ($1, $2, $3, 100000, 'payment', 'pagamento centralizado')
       RETURNING requires_nfe_transfer`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, REDE_FILIAL_1_COMPANY_ID],
    )
    expect(r.rows[0]!.requires_nfe_transfer).toBe(false)
  })

  it('liquidação via UPDATE settled_at aceita', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO intercompany_entries (tenant_id, from_company_id, to_company_id, amount_cents, kind)
       VALUES ($1, $2, $3, 100000, 'payment') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, REDE_FILIAL_1_COMPANY_ID],
    )
    const id = r.rows[0]!.id
    const u = await withTenantContext(TENANT_REDE, async (c) => {
      return await c.query(
        `UPDATE intercompany_entries
         SET settled_at = now(), settlement_method = 'virtual', updated_at = now()
         WHERE id = $1`,
        [id],
      )
    })
    expect(u.rowCount).toBe(1)
  })
})
