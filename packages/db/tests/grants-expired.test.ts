/**
 * `process_grants_expired()` SQL function — Sprint 01b D.6 (ADR 0019).
 *
 * Valida cron de limpa-cosmética que marca grants vencidos como `revoked`:
 *   - expires_at < now() AND revoked_at IS NULL → revoked_at = now(), revoked_reason = 'expired'
 *   - expires_at IS NULL → ignorado (perpétuo)
 *   - expires_at no futuro → ignorado
 *   - revoked_at já preenchido → ignorado (idempotente)
 *
 * **Pré-requisito**: `pnpm db:seed` populou cenário 1 (user Admin Rede existe).
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const REDE_TENANT_ID = '00000001-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'

// User fictício pra grants de teste (não conflita com Admin Rede do seed)
const TEST_USER_ID = '99999999-aaaa-aaaa-aaaa-000000000001'
const TEST_PERSON_PF_ID = '99999999-bbbb-bbbb-bbbb-000000000001'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name) VALUES ($1, $2, 'pf', 'User Grants Cron')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_PERSON_PF_ID, REDE_TENANT_ID],
  )
  await pool.query(
    `INSERT INTO users (id, tenant_id, person_id, username) VALUES ($1, $2, $3, 'cron-grants@test')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, REDE_TENANT_ID, TEST_PERSON_PF_ID],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM user_permission_grants WHERE user_id = $1', [TEST_USER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  await pool.query('DELETE FROM persons WHERE id = $1', [TEST_PERSON_PF_ID])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM user_permission_grants WHERE user_id = $1', [TEST_USER_ID])
})

interface ProcessResult {
  processed_at: string
  newly_revoked: number
  revoked_grant_ids: string[]
}

async function runProcess(): Promise<ProcessResult> {
  const r = await pool.query<{ process_grants_expired: ProcessResult }>(
    'SELECT process_grants_expired() AS process_grants_expired',
  )
  return r.rows[0]?.process_grants_expired as ProcessResult
}

describe('process_grants_expired()', () => {
  it('marca grant vencido (expires_at no passado) como revoked', async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'member.read', $3, now() - interval '1 day')
       RETURNING id`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    const grantId = r.rows[0]?.id

    const result = await runProcess()
    expect(result.newly_revoked).toBe(1)
    expect(result.revoked_grant_ids).toContain(grantId)

    const after = await pool.query<{ revoked_at: Date | null; revoked_reason: string | null }>(
      'SELECT revoked_at, revoked_reason FROM user_permission_grants WHERE id = $1',
      [grantId],
    )
    expect(after.rows[0]?.revoked_at).not.toBeNull()
    expect(after.rows[0]?.revoked_reason).toBe('expired')
  })

  it('ignora grant com expires_at no futuro', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'member.read', $3, now() + interval '7 days')`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    const result = await runProcess()
    expect(result.newly_revoked).toBe(0)
  })

  it('ignora grant sem expires_at (perpétuo)', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'member.read', $3, NULL)`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    const result = await runProcess()
    expect(result.newly_revoked).toBe(0)
  })

  it('idempotente — re-rodar não marca grants já revogados', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'member.read', $3, now() - interval '1 day')`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    const first = await runProcess()
    expect(first.newly_revoked).toBe(1)

    const second = await runProcess()
    expect(second.newly_revoked).toBe(0)
  })

  it('marca múltiplos grants em batch', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'member.read', $3, now() - interval '5 days')`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    await pool.query(
      `INSERT INTO user_permission_grants
         (tenant_id, user_id, permission_key, scope_company_id, expires_at)
       VALUES ($1, $2, 'person.read', $3, now() - interval '2 hours')`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )
    const result = await runProcess()
    expect(result.newly_revoked).toBe(2)
    expect(result.revoked_grant_ids.length).toBe(2)
  })

  it('payload tem shape esperado (processed_at + newly_revoked + revoked_grant_ids)', async () => {
    const result = await runProcess()
    expect(result).toHaveProperty('processed_at')
    expect(typeof result.newly_revoked).toBe('number')
    expect(Array.isArray(result.revoked_grant_ids)).toBe(true)
  })
})
