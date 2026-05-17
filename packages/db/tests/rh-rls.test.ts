/**
 * RH Comissões RLS + checks — Sprint 23 Faixa A.
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

async function getOrCreatePerson(tenantId: string, hint: string): Promise<string> {
  const email = `test-rh-${hint}-${tenantId.slice(0, 8)}@example.com`
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM persons WHERE tenant_id = $1 AND email = $2 LIMIT 1`,
    [tenantId, email],
  )
  if (existing.rows[0]) return existing.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', $2, $3) RETURNING id`,
    [tenantId, `Test RH ${hint}`, email],
  )
  return p.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of [
    'commission_entries',
    'commission_periods',
    'commission_rules',
    'professional_contracts',
  ]) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  // commission_rules sem tenant_id direto — apaga via JOIN (já cobertos pelo cascade do contract delete via FK; só por segurança extra)
  await pool
    .query(
      `DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'test-rh-%@example.com'`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of [
    'commission_entries',
    'commission_periods',
    'commission_rules',
    'professional_contracts',
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

describe('professional_contracts — checks + isolation', () => {
  it('contrato percent válido aceito', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'pct-valid')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, default_percent, effective_from)
         VALUES ($1, $2, $3, 'fisioterapia', 'percent_recebido', 'recebido_particular', 50, '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('contrato percent SEM default_percent rejeitado por CHECK', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'pct-missing')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, effective_from)
         VALUES ($1, $2, $3, 'fisioterapia', 'percent_recebido', 'recebido_particular', '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('contrato fixo_por_atendimento sem amount rejeitado', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'fix-missing')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, effective_from)
         VALUES ($1, $2, $3, 'fisioterapia', 'fixo_por_atendimento', 'recebido_particular', '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('contrato fixo OK com amount > 0', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'fix-ok')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, default_amount_cents, effective_from)
         VALUES ($1, $2, $3, 'personal_training', 'fixo_por_atendimento', 'recebido_particular', 5000, '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('contrato tabela_por_servico OK sem defaults (rules definem)', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'tabela')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, effective_from)
         VALUES ($1, $2, $3, 'fisioterapia', 'tabela_por_servico', 'misto', '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('percent > 100 rejeitado', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'pct-over')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, default_percent, effective_from)
         VALUES ($1, $2, $3, 'fisioterapia', 'percent_recebido', 'recebido_particular', 150, '2026-01-01')`,
        [TENANT_REDE, companyId, personId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'iso')
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, default_percent, effective_from)
       VALUES ($1, $2, $3, 'fisioterapia', 'percent_recebido', 'recebido_particular', 50, '2026-01-01') RETURNING id`,
      [TENANT_REDE, companyId, personId],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM professional_contracts WHERE id = $1', [cId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM professional_contracts WHERE id = $1', [cId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('commission_entries — checks', () => {
  async function createContract(): Promise<string> {
    const personId = await getOrCreatePerson(TENANT_REDE, 'entry-prof')
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO professional_contracts (tenant_id, company_id, person_id, service_type, kind, base, default_percent, effective_from)
       VALUES ($1, $2, $3, 'fisioterapia', 'percent_recebido', 'recebido_particular', 60, '2026-01-01') RETURNING id`,
      [TENANT_REDE, companyId, personId],
    )
    return r.rows[0]!.id
  }

  it('entry com net consistente (gross - retention) aceito', async () => {
    const contractId = await createContract()
    const personId = await getOrCreatePerson(TENANT_REDE, 'entry-prof')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_entries (tenant_id, contract_id, person_id, company_id, source_event_ref, reference_amount_cents, commission_cents, retention_total_cents, net_amount_cents, percent_applied)
         VALUES ($1, $2, $3, $4, 'payment:abc', 10000, 6000, 0, 6000, 60)`,
        [TENANT_REDE, contractId, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('entry com net inconsistente rejeitado', async () => {
    const contractId = await createContract()
    const personId = await getOrCreatePerson(TENANT_REDE, 'entry-prof')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_entries (tenant_id, contract_id, person_id, company_id, source_event_ref, reference_amount_cents, commission_cents, retention_total_cents, net_amount_cents)
         VALUES ($1, $2, $3, $4, 'payment:xyz', 10000, 6000, 500, 5000)`,
        [TENANT_REDE, contractId, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('unique (contract, source_event_ref) — mesma fonte 2× rejeitada', async () => {
    const contractId = await createContract()
    const personId = await getOrCreatePerson(TENANT_REDE, 'entry-prof')
    const companyId = await getMatriz(TENANT_REDE)
    await pool.query(
      `INSERT INTO commission_entries (tenant_id, contract_id, person_id, company_id, source_event_ref, reference_amount_cents, commission_cents, net_amount_cents)
       VALUES ($1, $2, $3, $4, 'payment:dup-001', 10000, 6000, 6000)`,
      [TENANT_REDE, contractId, personId, companyId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_entries (tenant_id, contract_id, person_id, company_id, source_event_ref, reference_amount_cents, commission_cents, net_amount_cents)
         VALUES ($1, $2, $3, $4, 'payment:dup-001', 20000, 12000, 12000)`,
        [TENANT_REDE, contractId, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })
})

describe('commission_periods — checks + unique', () => {
  it('period com net consistente aceito', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'period-prof')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_periods (tenant_id, person_id, company_id, period_start, period_end, total_entries, gross_total_cents, deductions_cents, retention_total_cents, net_total_cents)
         VALUES ($1, $2, $3, '2026-05-01', '2026-05-31', 10, 60000, 0, 8000, 52000)`,
        [TENANT_REDE, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('period com net inconsistente rejeitado', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'period-prof')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_periods (tenant_id, person_id, company_id, period_start, period_end, gross_total_cents, deductions_cents, retention_total_cents, net_total_cents)
         VALUES ($1, $2, $3, '2026-05-01', '2026-05-31', 60000, 0, 8000, 99999)`,
        [TENANT_REDE, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('unique (person, company, period_start, period_end) — duplicado rejeitado', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'period-uq')
    const companyId = await getMatriz(TENANT_REDE)
    await pool.query(
      `INSERT INTO commission_periods (tenant_id, person_id, company_id, period_start, period_end)
       VALUES ($1, $2, $3, '2026-05-01', '2026-05-31')`,
      [TENANT_REDE, personId, companyId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_periods (tenant_id, person_id, company_id, period_start, period_end)
         VALUES ($1, $2, $3, '2026-05-01', '2026-05-31')`,
        [TENANT_REDE, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('period_end < period_start rejeitado', async () => {
    const personId = await getOrCreatePerson(TENANT_REDE, 'period-reverse')
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO commission_periods (tenant_id, person_id, company_id, period_start, period_end)
         VALUES ($1, $2, $3, '2026-05-31', '2026-05-01')`,
        [TENANT_REDE, personId, companyId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})
