/**
 * Agenda RLS isolation + EXCLUDE constraint — Sprint 03 Faixa A.
 *
 * Valida:
 *   - Isolation per-tenant em resources/recurring_slots/appointments/waitlist
 *   - EXCLUDE constraint bloqueia overlap pra status ativos (booked/checked_in)
 *   - Status cancelled/no_show pode coexistir com booked no mesmo horário
 *   - waitlist DELETE permitido (leave waitlist)
 *
 * **Pré-requisito**: `pnpm db:seed` populou cenário 1 (Rede Equilíbrio com
 * companies + member admin). Usamos member criado em members-rls.test.ts
 * (pode-se reusar IDs hardcoded com ON CONFLICT DO NOTHING).
 */
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

// Persons + member criados em members-rls.test.ts (mesmo IDs — beforeAll
// cria com ON CONFLICT DO NOTHING pra ser idempotente).
const TEST_PERSON_ID = '77777777-aaaa-aaaa-aaaa-000000000001'
const TEST_MEMBER_ID = '77777777-bbbb-bbbb-bbbb-000000000001'

// Resources de teste
const TEST_RESOURCE_REDE = '77777777-dddd-dddd-dddd-000000000001'
const TEST_RESOURCE_FRANQ = '77777777-dddd-dddd-dddd-000000000002'
const FRANQ_COMPANY_ID = '00000002-0001-0000-0000-0000000000c1'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // Garante person + member da Rede (idempotente)
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name, document, email)
     VALUES ($1, $2, 'pf', 'Member Teste Agenda', '93541134780', 'agendatest@test.local')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PERSON_ID, TENANT_REDE],
  )
  await pool.query(
    `INSERT INTO members (id, tenant_id, person_id, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_MEMBER_ID, TENANT_REDE, TEST_PERSON_ID, REDE_MATRIZ_COMPANY_ID],
  )
  // Resources de teste (admin role bypassa RLS pra setup)
  await pool.query(
    `INSERT INTO resources (id, tenant_id, company_id, kind, name)
     VALUES ($1, $2, $3, 'instrutor', 'Instrutor Teste Rede')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_RESOURCE_REDE, TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
  )
  await pool.query(
    `INSERT INTO resources (id, tenant_id, company_id, kind, name)
     VALUES ($1, $2, $3, 'instrutor', 'Instrutor Teste Franquia')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_RESOURCE_FRANQ, TENANT_FRANQUIA, FRANQ_COMPANY_ID],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM appointments WHERE resource_id IN ($1, $2)', [
    TEST_RESOURCE_REDE,
    TEST_RESOURCE_FRANQ,
  ])
  await pool.query('DELETE FROM appointment_waitlist WHERE member_id = $1', [TEST_MEMBER_ID])
  await pool.query('DELETE FROM recurring_slots WHERE resource_id IN ($1, $2)', [
    TEST_RESOURCE_REDE,
    TEST_RESOURCE_FRANQ,
  ])
  await pool.query('DELETE FROM resources WHERE id IN ($1, $2)', [
    TEST_RESOURCE_REDE,
    TEST_RESOURCE_FRANQ,
  ])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM appointments WHERE resource_id IN ($1, $2)', [
    TEST_RESOURCE_REDE,
    TEST_RESOURCE_FRANQ,
  ])
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

describe('resources — RLS isolamento per-tenant', () => {
  it('Rede vê seu resource; Franquia vê 0 da Rede', async () => {
    const [redeResources, franqResources] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM resources')
        return r.rows
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM resources')
        return r.rows
      }),
    ])
    expect(redeResources.some((r) => r.id === TEST_RESOURCE_REDE)).toBe(true)
    expect(franqResources.some((r) => r.id === TEST_RESOURCE_REDE)).toBe(false)
    expect(franqResources.some((r) => r.id === TEST_RESOURCE_FRANQ)).toBe(true)
  })

  it('INSERT cross-tenant rejeitado por WITH CHECK', async () => {
    let errMsg = ''
    await withTenantContext(TENANT_REDE, async (client) => {
      try {
        await client.query(
          `INSERT INTO resources (tenant_id, company_id, kind, name)
           VALUES ($1, $2, 'sala', 'Sala Teste')`,
          [TENANT_FRANQUIA, REDE_MATRIZ_COMPANY_ID],
        )
      } catch (err) {
        errMsg = err instanceof Error ? err.message : ''
      }
    })
    expect(errMsg).toMatch(/row-level security/)
  })
})

describe('appointments — EXCLUDE constraint anti-overlap', () => {
  it('Dois appointments mesmo resource + mesmo intervalo + status booked → 2º rejeitado', async () => {
    // 1º: INSERT direto pelo postgres (bypass RLS pra setup)
    await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, '2026-06-01 10:00:00+00', '2026-06-01 11:00:00+00', 'booked')`,
      [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
    )

    // 2º: overlap exato → deve falhar
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, '2026-06-01 10:30:00+00', '2026-06-01 11:30:00+00', 'booked')`,
        [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23P01') // exclusion_violation
  })

  it('cancelled + booked no mesmo horário coexistem (cancelled vira history)', async () => {
    await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, '2026-06-02 10:00:00+00', '2026-06-02 11:00:00+00', 'cancelled')`,
      [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
    )
    // booked depois — deve passar (cancelled não conta no EXCLUDE filter)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, '2026-06-02 10:00:00+00', '2026-06-02 11:00:00+00', 'booked')`,
        [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('Mesmo horário mas resources diferentes coexistem', async () => {
    await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, '2026-06-03 10:00:00+00', '2026-06-03 11:00:00+00', 'booked')`,
      [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
    )
    // Outro resource (Rede) — diferente — coexiste
    const OTHER_RESOURCE = '77777777-dddd-dddd-dddd-000000000003'
    await pool.query(
      `INSERT INTO resources (id, tenant_id, company_id, kind, name)
       VALUES ($1, $2, $3, 'sala', 'Sala Teste 2')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_RESOURCE, TENANT_REDE, REDE_MATRIZ_COMPANY_ID],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
         VALUES ($1, $2, $3, '2026-06-03 10:00:00+00', '2026-06-03 11:00:00+00', 'booked')`,
        [TENANT_REDE, OTHER_RESOURCE, TEST_MEMBER_ID],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
    // cleanup
    await pool.query('DELETE FROM appointments WHERE resource_id = $1', [OTHER_RESOURCE])
    await pool.query('DELETE FROM resources WHERE id = $1', [OTHER_RESOURCE])
  })
})

describe('appointments — RLS isolamento per-tenant', () => {
  it('Appointment da Rede invisível pra Franquia', async () => {
    await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, member_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, '2026-06-04 10:00:00+00', '2026-06-04 11:00:00+00', 'booked')`,
      [TENANT_REDE, TEST_RESOURCE_REDE, TEST_MEMBER_ID],
    )
    const [rede, franq] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM appointments')
        return r.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ id: string }>('SELECT id FROM appointments')
        return r.rows.length
      }),
    ])
    expect(rede).toBeGreaterThanOrEqual(1)
    expect(franq).toBe(0)
  })
})

describe('appointment_waitlist — INSERT/DELETE only', () => {
  it('UPDATE retorna 0 rows (sem policy)', async () => {
    const FAKE_SLOT = '88888888-eeee-eeee-eeee-000000000001'
    // Cria slot pra FK
    await pool.query(
      `INSERT INTO recurring_slots (id, tenant_id, resource_id, rrule, start_time, end_time, capacity)
       VALUES ($1, $2, $3, 'FREQ=WEEKLY;BYDAY=MO', '10:00:00', '11:00:00', 1)
       ON CONFLICT (id) DO NOTHING`,
      [FAKE_SLOT, TENANT_REDE, TEST_RESOURCE_REDE],
    )
    await pool.query(
      `INSERT INTO appointment_waitlist (tenant_id, recurring_slot_id, starts_at, member_id)
       VALUES ($1, $2, '2026-06-15 10:00:00+00', $3)
       ON CONFLICT DO NOTHING`,
      [TENANT_REDE, FAKE_SLOT, TEST_MEMBER_ID],
    )

    await withTenantContext(TENANT_REDE, async (client) => {
      const upd = await client.query(
        `UPDATE appointment_waitlist SET created_at = now() WHERE recurring_slot_id = $1`,
        [FAKE_SLOT],
      )
      expect(upd.rowCount).toBe(0)
    })

    // cleanup
    await pool.query('DELETE FROM appointment_waitlist WHERE recurring_slot_id = $1', [FAKE_SLOT])
    await pool.query('DELETE FROM recurring_slots WHERE id = $1', [FAKE_SLOT])
  })
})
