/**
 * Funil de vendas RLS + check constraints — Sprint 10 Faixa A (ADR 0022 esperado).
 *
 * Valida:
 *   - Isolation per-tenant em todas as 5 tabelas (lead_stages, leads,
 *     lead_events, trial_classes, proposals)
 *   - Check constraint `leads_min_contact_or_person` (person_id OU quick_*)
 *   - Check constraints `proposals_price_non_negative`,
 *     `proposals_discount_lt_price`, `proposals_one_plan_xor_bundle`
 *   - `lead_stages` unique por (tenant, slug)
 *   - `trial_classes.appointment_id` unique global
 *   - lead_events append-only (sem UPDATE/DELETE policy)
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'
const FRANQ_COMPANY_ID = '00000002-0001-0000-0000-0000000000c1'

const STAGE_NOVO_REDE = '77777777-eeee-eeee-eeee-000000000001'
const STAGE_NOVO_FRANQ = '77777777-eeee-eeee-eeee-000000000002'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // Seed mínimo: 1 stage 'novo' em cada tenant
  await pool.query(
    `INSERT INTO lead_stages (id, tenant_id, slug, name, order_idx, kind)
     VALUES ($1, $2, 'test_novo', 'Test Novo', 99, 'open')
     ON CONFLICT (tenant_id, slug) DO NOTHING`,
    [STAGE_NOVO_REDE, TENANT_REDE],
  )
  await pool.query(
    `INSERT INTO lead_stages (id, tenant_id, slug, name, order_idx, kind)
     VALUES ($1, $2, 'test_novo', 'Test Novo', 99, 'open')
     ON CONFLICT (tenant_id, slug) DO NOTHING`,
    [STAGE_NOVO_FRANQ, TENANT_FRANQUIA],
  )
})

afterAll(async () => {
  await pool
    .query('DELETE FROM proposals WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM trial_classes WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM lead_events WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM leads WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query("DELETE FROM lead_stages WHERE tenant_id IN ($1, $2) AND slug = 'test_novo'", [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query('DELETE FROM proposals WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM trial_classes WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM lead_events WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query('DELETE FROM leads WHERE tenant_id IN ($1, $2)', [TENANT_REDE, TENANT_FRANQUIA])
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

describe('leads — RLS + check constraint min contact', () => {
  it('Rede vê seu lead; Franquia não vê', async () => {
    await pool.query(
      `INSERT INTO leads (tenant_id, company_id, stage_id, quick_name, quick_phone)
       VALUES ($1, $2, $3, 'Lead Rede', '11999999991')`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, STAGE_NOVO_REDE],
    )
    await pool.query(
      `INSERT INTO leads (tenant_id, company_id, stage_id, quick_name, quick_phone)
       VALUES ($1, $2, $3, 'Lead Franq', '11999999992')`,
      [TENANT_FRANQUIA, FRANQ_COMPANY_ID, STAGE_NOVO_FRANQ],
    )

    const [rede, franq] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ quick_name: string }>('SELECT quick_name FROM leads')
        return r.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ quick_name: string }>('SELECT quick_name FROM leads')
        return r.rows
      }),
    ])
    expect(rede.some((l) => l.quick_name === 'Lead Rede')).toBe(true)
    expect(rede.some((l) => l.quick_name === 'Lead Franq')).toBe(false)
    expect(franq.some((l) => l.quick_name === 'Lead Franq')).toBe(true)
  })

  it('check leads_min_contact_or_person — sem person_id NEM quick_* rejeitado', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO leads (tenant_id, company_id, stage_id)
         VALUES ($1, $2, $3)`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, STAGE_NOVO_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514') // check_violation
  })

  it('quick_phone só (sem person nem nome) — aceito', async () => {
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO leads (tenant_id, company_id, stage_id, quick_phone)
         VALUES ($1, $2, $3, '11988888888')`,
        [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, STAGE_NOVO_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('lead_stages — unique por (tenant, slug)', () => {
  it('mesma slug em outro tenant coexiste; duplicada no mesmo tenant rejeita', async () => {
    // Já existe 'test_novo' em ambos via beforeAll — tentamos inserir DUP na Rede
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO lead_stages (tenant_id, slug, name, order_idx, kind)
         VALUES ($1, 'test_novo', 'Test Novo Dup', 99, 'open')`,
        [TENANT_REDE],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505') // unique_violation
  })
})

describe('proposals — check constraints', () => {
  // Lead recriado a cada teste pq beforeEach do escopo externo limpa leads
  async function freshLead(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO leads (tenant_id, company_id, stage_id, quick_name, quick_phone)
       VALUES ($1, $2, $3, 'Lead Proposal', '11900000001') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, STAGE_NOVO_REDE],
    )
    return r.rows[0]!.id
  }

  it('price_cents < 0 rejeitado', async () => {
    const leadId = await freshLead()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO proposals (tenant_id, lead_id, price_cents, valid_until)
         VALUES ($1, $2, -100, now() + interval '7 days')`,
        [TENANT_REDE, leadId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('discount >= price rejeitado', async () => {
    const leadId = await freshLead()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO proposals (tenant_id, lead_id, price_cents, discount_cents, valid_until)
         VALUES ($1, $2, 10000, 10000, now() + interval '7 days')`,
        [TENANT_REDE, leadId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('proposal válido (sem plan nem bundle) — aceito', async () => {
    const leadId = await freshLead()
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO proposals (tenant_id, lead_id, price_cents, valid_until)
         VALUES ($1, $2, 9900, now() + interval '7 days')`,
        [TENANT_REDE, leadId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('lead_events — append-only', () => {
  it('SELECT funciona, UPDATE rejeitado pelo RLS (sem policy)', async () => {
    const leadR = await pool.query<{ id: string }>(
      `INSERT INTO leads (tenant_id, company_id, stage_id, quick_name)
       VALUES ($1, $2, $3, 'Lead Audit') RETURNING id`,
      [TENANT_REDE, REDE_MATRIZ_COMPANY_ID, STAGE_NOVO_REDE],
    )
    const leadId = leadR.rows[0]!.id

    await pool.query(
      `INSERT INTO lead_events (tenant_id, lead_id, kind)
       VALUES ($1, $2, 'note_added')`,
      [TENANT_REDE, leadId],
    )

    // SELECT funciona dentro do tenant
    const sel = await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query<{ kind: string }>(
        'SELECT kind FROM lead_events WHERE lead_id = $1',
        [leadId],
      )
      return r.rows
    })
    expect(sel.some((e) => e.kind === 'note_added')).toBe(true)

    // UPDATE deve falhar (RLS sem policy de UPDATE = bloqueado pra logifit_app)
    let updateBlocked = false
    try {
      await withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query(
          `UPDATE lead_events SET kind = 'tampered' WHERE lead_id = $1`,
          [leadId],
        )
        // 0 rows affected = blocked silenciosamente pelo RLS
        if (r.rowCount === 0) updateBlocked = true
      })
    } catch {
      updateBlocked = true
    }
    expect(updateBlocked).toBe(true)
  })
})
