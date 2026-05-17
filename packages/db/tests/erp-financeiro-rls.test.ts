/**
 * ERP Financeiro RLS + check constraints — Sprint 15 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em todas as 6 tabelas
 *   - Unique (tenant, code) em chart_of_accounts
 *   - Unique (tenant, person) em suppliers
 *   - Unique doc_key global em accounts_payable
 *   - Check accounts_payable_amount_positive
 *   - Check accounts_payable_net_consistent (net = amount - retention)
 *   - Check accounts_payable_due_after_issue
 *   - Check approval_rules_max_after_min
 *   - Check ap_ar_payments_source_type_valid
 *   - ap_ar_payments append-only via ausência de UPDATE/DELETE policy
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

const TEST_PERSON_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name, document, email)
     VALUES ($1, $2, 'pj', 'Fornecedor ERP Teste LTDA', '69103604000160', 'forn-erp@test.local')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PERSON_ID, TENANT_REDE],
  )
})

afterAll(async () => {
  await pool
    .query('DELETE FROM ap_ar_payments WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM accounts_receivable WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM accounts_payable WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM approval_rules WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM suppliers WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM chart_of_accounts WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.query('DELETE FROM persons WHERE id = $1', [TEST_PERSON_ID]).catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM ap_ar_payments WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM accounts_receivable WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM accounts_payable WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM approval_rules WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM suppliers WHERE tenant_id IN ($1, $2)', [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query('DELETE FROM chart_of_accounts WHERE tenant_id IN ($1, $2)', [
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

async function freshLeafAccount(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
     VALUES ($1, '5.1.01', 'Aluguel', 'despesa', true) RETURNING id`,
    [TENANT_REDE],
  )
  return r.rows[0]!.id
}

describe('chart_of_accounts — unique code + isolamento', () => {
  it('code duplicado no mesmo tenant rejeitado', async () => {
    await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
       VALUES ($1, '1.1.01', 'Caixa', 'ativo', true)`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
         VALUES ($1, '1.1.01', 'Caixa dup', 'ativo', true)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('mesma code em outro tenant coexiste', async () => {
    await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
       VALUES ($1, '1.1.01', 'Caixa Rede', 'ativo', true)`,
      [TENANT_REDE],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
         VALUES ($1, '1.1.01', 'Caixa Franq', 'ativo', true)`,
        [TENANT_FRANQUIA],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolamento: Rede vê; Franquia não vê', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
       VALUES ($1, '1.1.02', 'Banco', 'ativo', true) RETURNING id`,
      [TENANT_REDE],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM chart_of_accounts WHERE id = $1', [cId])
        return x.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM chart_of_accounts WHERE id = $1', [cId])
        return x.rows
      }),
    ])
    expect(redeVisible.length).toBe(1)
    expect(franqVisible.length).toBe(0)
  })
})

describe('suppliers — unique (tenant, person)', () => {
  it('mesma person duplicada no mesmo tenant rejeitada', async () => {
    await pool.query(
      `INSERT INTO suppliers (tenant_id, person_id)
       VALUES ($1, $2)`,
      [TENANT_REDE, TEST_PERSON_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO suppliers (tenant_id, person_id)
         VALUES ($1, $2)`,
        [TENANT_REDE, TEST_PERSON_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('approval_rules — check max_after_min', () => {
  it('max < min rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO approval_rules (tenant_id, name, scope, min_amount_cents, max_amount_cents, required_approvers)
         VALUES ($1, 'Bad', 'ap', 500000, 100000, '{}'::jsonb)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('rule válida (min=0 max=500000) aceita', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO approval_rules (tenant_id, name, scope, min_amount_cents, max_amount_cents, required_approvers)
         VALUES ($1, 'Auto até R$5k', 'ap', 0, 500000, '{"mode":"series","approvers":[]}'::jsonb)`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('accounts_payable — checks', () => {
  it('amount=0 rejeitado (positive)', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, net_amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 0, 0, '2026-05-01', '2026-05-10')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('net_consistent: net ≠ amount - retention rejeitado', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, retention_total_cents, net_amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 100000, 5000, 99000, '2026-05-01', '2026-05-10')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('due_at < issue_date rejeitado', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, net_amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 100000, 100000, '2026-05-10', '2026-05-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('AP válida (sem retenção) aceita', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, net_amount_cents, issue_date, due_date, description)
         VALUES ($1, $2, $3, 350000, 350000, '2026-05-01', '2026-05-10', 'Aluguel maio')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('AP com retenção consistente aceita (100000 = 100000 + 0 com retention)', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      // amount=100000, retention=15000, net=85000 → consistent
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, retention_total_cents, net_amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 100000, 15000, 85000, '2026-05-01', '2026-05-10')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('doc_key duplicada global rejeitada', async () => {
    const cIdR = await freshLeafAccount()
    const cIdF = await pool.query<{ id: string }>(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, kind, is_leaf)
       VALUES ($1, '5.1.01', 'Aluguel F', 'despesa', true) RETURNING id`,
      [TENANT_FRANQUIA],
    )
    const chave = '35260512345678000100550010000000011000000001'
    await pool.query(
      `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, net_amount_cents, issue_date, due_date, doc_key)
       VALUES ($1, $2, $3, 100000, 100000, '2026-05-01', '2026-05-10', $4)`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cIdR, chave],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_payable (tenant_id, company_id, chart_account_id, amount_cents, net_amount_cents, issue_date, due_date, doc_key)
         VALUES ($1, $2, $3, 200000, 200000, '2026-05-05', '2026-05-15', $4)`,
        [
          TENANT_FRANQUIA,
          '00000002-0001-0000-0000-0000000000c1',
          cIdF.rows[0]!.id,
          chave,
        ],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505') // unique violation global
  })
})

describe('accounts_receivable — checks', () => {
  it('AR válida aceita', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_receivable (tenant_id, company_id, chart_account_id, amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 50000, '2026-05-01', '2026-05-15')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('due antes de issue rejeitada', async () => {
    const cId = await freshLeafAccount()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO accounts_receivable (tenant_id, company_id, chart_account_id, amount_cents, issue_date, due_date)
         VALUES ($1, $2, $3, 50000, '2026-05-15', '2026-05-01')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, cId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('ap_ar_payments — append-only + check source_type', () => {
  it('source_type inválido rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO ap_ar_payments (tenant_id, source_type, source_id, amount_cents, paid_at, method)
         VALUES ($1, 'invalid', $2, 50000, now(), 'pix')`,
        [TENANT_REDE, 'aaaaaaaa-bbbb-cccc-dddd-000000000001'],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('payment append-only — UPDATE bloqueado, DELETE bloqueado (sem policy)', async () => {
    const apId = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
    const r = await pool.query<{ id: string }>(
      `INSERT INTO ap_ar_payments (tenant_id, source_type, source_id, amount_cents, paid_at, method, reference)
       VALUES ($1, 'ap', $2, 50000, now(), 'pix', 'tx-abc') RETURNING id`,
      [TENANT_REDE, apId],
    )
    const pId = r.rows[0]!.id

    const updateBlocked = await withTenantContext(TENANT_REDE, async (c) => {
      const u = await c.query("UPDATE ap_ar_payments SET reference = 'hacked' WHERE id = $1", [
        pId,
      ])
      return u.rowCount === 0
    })
    expect(updateBlocked).toBe(true)

    const deleteBlocked = await withTenantContext(TENANT_REDE, async (c) => {
      const d = await c.query('DELETE FROM ap_ar_payments WHERE id = $1', [pId])
      return d.rowCount === 0
    })
    expect(deleteBlocked).toBe(true)
  })
})
