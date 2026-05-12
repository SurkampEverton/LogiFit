/**
 * `has_permission()` SQL function — Sprint 01b D.1 (ADR 0019).
 *
 * Valida union de user_roles + user_permission_grants ativos respeitando
 * scope + expires_at + revoked_at.
 *
 * **Pré-requisito**: `pnpm db:seed` populou cenário 1 (Admin Rede tem role
 * `tenant_owner` que dá todas as 25 permissions canônicas).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// Do seed cenário 1 (Rede Equilíbrio) — admin com role tenant_owner
const REDE_ADMIN_USER_ID = '00000001-0001-0000-0000-0000000000e1'
const REDE_TENANT_ID = '00000001-0001-0000-0000-000000000010'
const REDE_MATRIZ_COMPANY_ID = '00000001-0001-0000-0000-0000000000c1'
const REDE_FILIAL_SUL_COMPANY_ID = '00000001-0001-0000-0000-0000000000c2'

// User fictício pra testes de grant direto
const TEST_USER_ID = '88888888-aaaa-aaaa-aaaa-000000000001'
const TEST_PERSON_PF_ID = '88888888-bbbb-bbbb-bbbb-000000000001'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })

  // Cria user fictício pro tenant Rede (sem role) pra testar grants diretos
  await pool.query(
    `INSERT INTO persons (id, tenant_id, kind, name) VALUES ($1, $2, 'pf', 'User Sem Role') ON CONFLICT DO NOTHING`,
    [TEST_PERSON_PF_ID, REDE_TENANT_ID],
  )
  await pool.query(
    `INSERT INTO users (id, tenant_id, person_id, username) VALUES ($1, $2, $3, 'sem-role@test') ON CONFLICT DO NOTHING`,
    [TEST_USER_ID, REDE_TENANT_ID, TEST_PERSON_PF_ID],
  )
})

afterAll(async () => {
  // Cleanup do user fictício
  await pool.query(`DELETE FROM user_permission_grants WHERE user_id = $1`, [TEST_USER_ID])
  await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  await pool.query(`DELETE FROM persons WHERE id = $1`, [TEST_PERSON_PF_ID])
  await pool.end()
})

beforeEach(async () => {
  // Limpa grants entre testes
  await pool.query(`DELETE FROM user_permission_grants WHERE user_id = $1`, [TEST_USER_ID])
})

async function hasPermission(
  userId: string,
  permission: string,
  scopeType?: string,
  scopeId?: string,
): Promise<boolean> {
  const r = await pool.query<{ has_permission: boolean }>(
    `SELECT has_permission($1, $2, $3, $4) AS has_permission`,
    [userId, permission, scopeType ?? null, scopeId ?? null],
  )
  return r.rows[0]?.has_permission === true
}

describe('has_permission — via role (tenant_owner)', () => {
  it('Admin Rede tem person.read (tenant scope)', async () => {
    expect(await hasPermission(REDE_ADMIN_USER_ID, 'person.read', 'tenant', REDE_TENANT_ID)).toBe(
      true,
    )
  })

  it('Admin Rede tem person.write em qualquer company', async () => {
    expect(
      await hasPermission(REDE_ADMIN_USER_ID, 'person.write', 'company', REDE_MATRIZ_COMPANY_ID),
    ).toBe(true)
    expect(
      await hasPermission(
        REDE_ADMIN_USER_ID,
        'person.write',
        'company',
        REDE_FILIAL_SUL_COMPANY_ID,
      ),
    ).toBe(true)
  })

  it('Admin Rede sem scope (consulta global) → true', async () => {
    expect(await hasPermission(REDE_ADMIN_USER_ID, 'company.write')).toBe(true)
  })

  it('Permission inexistente → false', async () => {
    expect(await hasPermission(REDE_ADMIN_USER_ID, 'permission.fake')).toBe(false)
  })
})

describe('has_permission — user sem role', () => {
  it('User fictício sem role → false pra todas', async () => {
    expect(await hasPermission(TEST_USER_ID, 'person.read')).toBe(false)
    expect(await hasPermission(TEST_USER_ID, 'company.write')).toBe(false)
  })

  it('User inexistente → false', async () => {
    expect(await hasPermission('99999999-9999-9999-9999-999999999999', 'person.read')).toBe(false)
  })
})

describe('has_permission — via grant direto', () => {
  it('Grant tenant-wide ativo → true pra qualquer scope', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
        (tenant_id, user_id, permission_key, scope_company_id, scope_unit_id, granted_at)
       VALUES ($1, $2, 'person.read', NULL, NULL, now())`,
      [REDE_TENANT_ID, TEST_USER_ID],
    )

    expect(await hasPermission(TEST_USER_ID, 'person.read')).toBe(true)
    expect(
      await hasPermission(TEST_USER_ID, 'person.read', 'company', REDE_MATRIZ_COMPANY_ID),
    ).toBe(true)
  })

  it('Grant com scope_company_id específico → true SÓ na company; false em outra', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
        (tenant_id, user_id, permission_key, scope_company_id, granted_at)
       VALUES ($1, $2, 'person.write', $3, now())`,
      [REDE_TENANT_ID, TEST_USER_ID, REDE_MATRIZ_COMPANY_ID],
    )

    expect(
      await hasPermission(TEST_USER_ID, 'person.write', 'company', REDE_MATRIZ_COMPANY_ID),
    ).toBe(true)
    expect(
      await hasPermission(TEST_USER_ID, 'person.write', 'company', REDE_FILIAL_SUL_COMPANY_ID),
    ).toBe(false)
  })

  it('Grant com expires_at no passado → ignorado (false)', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
        (tenant_id, user_id, permission_key, granted_at, expires_at)
       VALUES ($1, $2, 'person.read', now() - interval '5 days', now() - interval '1 day')`,
      [REDE_TENANT_ID, TEST_USER_ID],
    )

    expect(await hasPermission(TEST_USER_ID, 'person.read')).toBe(false)
  })

  it('Grant com expires_at no futuro → válido (true)', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
        (tenant_id, user_id, permission_key, granted_at, expires_at)
       VALUES ($1, $2, 'person.read', now(), now() + interval '30 days')`,
      [REDE_TENANT_ID, TEST_USER_ID],
    )

    expect(await hasPermission(TEST_USER_ID, 'person.read')).toBe(true)
  })

  it('Grant revogado (revoked_at NOT NULL) → ignorado (false)', async () => {
    await pool.query(
      `INSERT INTO user_permission_grants
        (tenant_id, user_id, permission_key, granted_at, revoked_at, revoked_reason)
       VALUES ($1, $2, 'person.read', now() - interval '5 days', now() - interval '1 hour', 'test revocation')`,
      [REDE_TENANT_ID, TEST_USER_ID],
    )

    expect(await hasPermission(TEST_USER_ID, 'person.read')).toBe(false)
  })
})
