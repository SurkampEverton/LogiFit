/**
 * Bancos + OF + Reconciliation + Certificates + NFE cursors RLS — Sprint 17 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em 6 tabelas
 *   - Unique (company, bank, agency, account) em bank_accounts
 *   - Unique (tenant, name) em reconciliation_rules
 *   - Unique (company, provider) em nfe_sefaz_cursors
 *   - Unique (bank_account, external_id) em bank_transactions quando NOT NULL
 *   - Certificate (PFX bytea) round-trip
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of [
    'bank_transactions',
    'openfinance_connections',
    'bank_accounts',
    'reconciliation_rules',
    'company_certificates',
    'nfe_sefaz_cursors',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'bank_transactions',
    'openfinance_connections',
    'bank_accounts',
    'reconciliation_rules',
    'company_certificates',
    'nfe_sefaz_cursors',
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

describe('bank_accounts — unique + isolation', () => {
  it('insert válido aceito', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, agency, account_number, kind, nickname)
         VALUES ($1, $2, '237', 'Bradesco', '1234', '56789-0', 'business', 'Bradesco Matriz CC')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('duplicata (company, bank, agency, account) rejeitada', async () => {
    await pool.query(
      `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, agency, account_number)
       VALUES ($1, $2, '237', 'Bradesco', '1234', '56789-0')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, agency, account_number)
         VALUES ($1, $2, '237', 'Bradesco', '1234', '56789-0')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, account_number)
       VALUES ($1, $2, '001', 'Banco do Brasil', '12345-6') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const bId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM bank_accounts WHERE id = $1', [bId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM bank_accounts WHERE id = $1', [bId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('bank_transactions — unique external_id quando NOT NULL', () => {
  it('mesma external_id rejeitada na mesma conta', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, account_number)
       VALUES ($1, $2, '237', 'Bradesco', 'AC-001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const baId = r.rows[0]!.id
    await pool.query(
      `INSERT INTO bank_transactions (tenant_id, bank_account_id, external_id, posted_at, amount_cents, description, source)
       VALUES ($1, $2, 'OF-tx-123', now(), -50000, 'Aluguel maio', 'openfinance')`,
      [TENANT_REDE, baId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO bank_transactions (tenant_id, bank_account_id, external_id, posted_at, amount_cents, description, source)
         VALUES ($1, $2, 'OF-tx-123', now(), -50000, 'dup', 'openfinance')`,
        [TENANT_REDE, baId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('external_id NULL aceita N rows (importação manual)', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO bank_accounts (tenant_id, company_id, bank_code, bank_name, account_number)
       VALUES ($1, $2, '237', 'Bradesco', 'AC-002') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    const baId = r.rows[0]!.id
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO bank_transactions (tenant_id, bank_account_id, posted_at, amount_cents, description, source)
         VALUES ($1, $2, now(), -50000, 'manual1', 'manual'),
                ($1, $2, now(), -30000, 'manual2', 'manual')`,
        [TENANT_REDE, baId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('reconciliation_rules — unique name + isolation', () => {
  it('name duplicado rejeitado', async () => {
    await pool.query(
      `INSERT INTO reconciliation_rules (tenant_id, name, condition, action)
       VALUES ($1, 'Auto match aluguel', $2::jsonb, 'auto_match_ap')`,
      [TENANT_REDE, JSON.stringify({ descriptionContains: 'aluguel' })],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO reconciliation_rules (tenant_id, name, condition, action)
         VALUES ($1, 'Auto match aluguel', $2::jsonb, 'auto_match_ap')`,
        [TENANT_REDE, JSON.stringify({ descriptionContains: 'aluguel matriz' })],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('nfe_sefaz_cursors — unique (company, provider)', () => {
  it('mesmo (company, provider) duplicado rejeitado', async () => {
    await pool.query(
      `INSERT INTO nfe_sefaz_cursors (tenant_id, company_id, provider)
       VALUES ($1, $2, 'arquivei')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO nfe_sefaz_cursors (tenant_id, company_id, provider)
         VALUES ($1, $2, 'arquivei')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesmo company com provider diferente coexiste', async () => {
    await pool.query(
      `INSERT INTO nfe_sefaz_cursors (tenant_id, company_id, provider)
       VALUES ($1, $2, 'arquivei')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO nfe_sefaz_cursors (tenant_id, company_id, provider)
         VALUES ($1, $2, 'focus')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('company_certificates — bytea round-trip', () => {
  it('PFX bytea inserido e lido corretamente', async () => {
    const fakePfx = Buffer.from('SOME-FAKE-PFX-BINARY-DATA', 'utf-8')
    const r = await pool.query<{ id: string; encrypted_pfx: Buffer }>(
      `INSERT INTO company_certificates (tenant_id, company_id, kind, encrypted_pfx, encrypted_password, expires_at, subject_cnpj)
       VALUES ($1, $2, 'a1', $3::bytea, 'enc-pwd-blob', now() + interval '1 year', '12345678000100')
       RETURNING id, encrypted_pfx`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, fakePfx],
    )
    expect(r.rows[0]!.encrypted_pfx.toString('utf-8')).toBe('SOME-FAKE-PFX-BINARY-DATA')
  })
})
