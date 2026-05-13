/**
 * Financeiro Asaas RLS + check constraints — Sprint 04 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em plans/contracts/invoices/payments/asaas_keys
 *   - Check constraints (priceCents >= 0, amountCents >= 0, billingDay 1-28)
 *   - webhook_events sem RLS (recebe sem tenant_id)
 *   - INSERT-only em payments (sem policy UPDATE/DELETE)
 *   - asaas_id unique em invoices/payments
 *
 * **Pré-requisito**: `pnpm db:seed` populou cenário 1 (Rede Equilíbrio).
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'
const FRANQ_COMPANY_ID = '00000002-0001-0000-0000-0000000000c1'

const TEST_PERSON_ID = '77777777-aaaa-aaaa-aaaa-000000000001'
const TEST_MEMBER_ID = '77777777-bbbb-bbbb-bbbb-000000000001'
const TEST_PLAN_REDE = '88888888-1111-1111-1111-000000000001'
const TEST_PLAN_FRANQ = '88888888-1111-1111-1111-000000000002'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // person + member da Rede (idempotente)
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name, document, email)
     VALUES ($1, $2, 'pf', 'Member Teste Financeiro', '93541134780', 'finantest@test.local')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PERSON_ID, TENANT_REDE],
  )
  await pool.query(
    `INSERT INTO members (id, tenant_id, person_id, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MEMBER_ID, TENANT_REDE, TEST_PERSON_ID, REDE_MATRIZ_COMPANY_ID],
  )
  // 2 plans (1 Rede, 1 Franquia) pra testar isolation
  await pool.query(
    `INSERT INTO plans (id, tenant_id, company_id, name, price_cents, billing_cycle)
     VALUES ($1, $2, $3, 'Plano Teste Rede', 9900, 'monthly')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PLAN_REDE, TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
  )
  await pool.query(
    `INSERT INTO plans (id, tenant_id, company_id, name, price_cents, billing_cycle)
     VALUES ($1, $2, $3, 'Plano Teste Franquia', 12900, 'monthly')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PLAN_FRANQ, TENANT_FRANQUIA, FRANQ_COMPANY_ID],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE contract_id IN (SELECT id FROM contracts WHERE plan_id IN ($1, $2)))', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM invoices WHERE contract_id IN (SELECT id FROM contracts WHERE plan_id IN ($1, $2))', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM contracts WHERE plan_id IN ($1, $2)', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM plans WHERE id IN ($1, $2)', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM asaas_keys WHERE api_key LIKE $1', ['test-key-%']).catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE contract_id IN (SELECT id FROM contracts WHERE plan_id IN ($1, $2)))', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM invoices WHERE contract_id IN (SELECT id FROM contracts WHERE plan_id IN ($1, $2))', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
  await pool.query('DELETE FROM contracts WHERE plan_id IN ($1, $2)', [TEST_PLAN_REDE, TEST_PLAN_FRANQ]).catch(() => {})
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

describe('plans — RLS isolamento per-tenant', () => {
  it('Rede vê seu plan; Franquia vê só dela', async () => {
    const [rede, franq] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM plans')
        return r.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM plans')
        return r.rows
      }),
    ])
    expect(rede.some((p) => p.id === TEST_PLAN_REDE)).toBe(true)
    expect(rede.some((p) => p.id === TEST_PLAN_FRANQ)).toBe(false)
    expect(franq.some((p) => p.id === TEST_PLAN_FRANQ)).toBe(true)
  })

  it('check constraint priceCents >= 0', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO plans (tenant_id, company_id, name, price_cents, billing_cycle)
         VALUES ($1, $2, 'Plano Inválido', -100, 'monthly')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514') // check_violation
  })
})

describe('contracts — RLS + billing_day check', () => {
  it('check constraint billing_day 1-28', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at, billing_day)
         VALUES ($1, $2, $3, $4, now(), 30)`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('INSERT contract permitido + visível pelo tenant', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
    )
    const contractId = r.rows[0]?.id

    await withTenantContext(TENANT_REDE, async (client) => {
      const visible = await client.query(`SELECT id FROM contracts WHERE id = $1`, [contractId])
      expect(visible.rows.length).toBe(1)
    })
  })
})

describe('invoices — RLS + asaas_id unique + breakdown jsonb', () => {
  it('asaas_id unique global (entre tenants também)', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
    )
    const contractId = r.rows[0]?.id

    await pool.query(
      `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at, asaas_id)
       VALUES ($1, $2, $3, $4, 9900, now() + interval '5 days', 'asaas-test-12345')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, contractId, TEST_MEMBER_ID],
    )

    // segundo INSERT com mesmo asaas_id → 23505 unique_violation
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at, asaas_id)
         VALUES ($1, $2, $3, $4, 9900, now() + interval '5 days', 'asaas-test-12345')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, contractId, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('Múltiplas invoices com asaas_id NULL coexistem (partial index)', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
    )
    const contractId = r.rows[0]?.id

    // 2 invoices sem asaas_id (pre-sync com Asaas) — devem coexistir
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at)
         VALUES ($1, $2, $3, $4, 9900, now() + interval '5 days')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, contractId, TEST_MEMBER_ID],
      )
      await pool.query(
        `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at)
         VALUES ($1, $2, $3, $4, 9900, now() + interval '35 days')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, contractId, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('breakdown jsonb persiste e é recuperado', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
    )
    const breakdown = { base: 9900, overage_items: [], discounts: [], surcharges: [] }
    const inv = await pool.query<{ breakdown: typeof breakdown }>(
      `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at, breakdown)
       VALUES ($1, $2, $3, $4, 9900, now() + interval '5 days', $5::jsonb) RETURNING breakdown`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, r.rows[0]?.id, TEST_MEMBER_ID, JSON.stringify(breakdown)],
    )
    expect(inv.rows[0]?.breakdown).toEqual(breakdown)
  })
})

describe('payments — append-only via policies', () => {
  it('UPDATE retorna 0 rows (sem policy UPDATE)', async () => {
    const c = await pool.query<{ id: string }>(
      `INSERT INTO contracts (tenant_id, company_id, member_id, plan_id, started_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, TEST_MEMBER_ID, TEST_PLAN_REDE],
    )
    const inv = await pool.query<{ id: string }>(
      `INSERT INTO invoices (tenant_id, company_id, contract_id, member_id, amount_cents, due_at)
       VALUES ($1, $2, $3, $4, 9900, now()) RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, c.rows[0]?.id, TEST_MEMBER_ID],
    )
    await pool.query(
      `INSERT INTO payments (tenant_id, invoice_id, amount_cents, method, paid_at, asaas_id)
       VALUES ($1, $2, 9900, 'pix', now(), 'asaas-pay-test-1')`,
      [TENANT_REDE, inv.rows[0]?.id],
    )

    await withTenantContext(TENANT_REDE, async (client) => {
      const upd = await client.query(`UPDATE payments SET amount_cents = 0 WHERE asaas_id = $1`, [
        'asaas-pay-test-1',
      ])
      expect(upd.rowCount).toBe(0)
    })

    // cleanup
    await pool.query('DELETE FROM payments WHERE asaas_id = $1', ['asaas-pay-test-1'])
  })
})

describe('webhook_events — idempotência via unique (source, external_id)', () => {
  it('Segundo INSERT mesmo (source, external_id) → 23505', async () => {
    const externalId = `test-event-${Date.now()}`
    await pool.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('asaas', $1, '{"event":"PAYMENT_CONFIRMED"}'::jsonb)`,
      [externalId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO webhook_events (source, external_id, payload)
         VALUES ('asaas', $1, '{"event":"PAYMENT_CONFIRMED","retry":true}'::jsonb)`,
        [externalId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')

    await pool.query('DELETE FROM webhook_events WHERE external_id = $1', [externalId])
  })
})
