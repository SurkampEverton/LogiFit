/**
 * Helper E2E — cria/limpa members de teste via pool Postgres.
 *
 * Bypass RLS via `SET row_security = off` (caller é superuser postgres).
 * Cleanup idempotente — DELETE não fail se não existe.
 *
 * Usado pra testes que precisam de fixture de paciente real (magic link e2e).
 */
import { Pool } from 'pg'

const TEST_TENANT_SLUG = 'academia-equilibrio'

export interface TestMember {
  tenantId: string
  tenantSlug: string
  companyId: string
  personId: string
  memberId: string
  email: string
}

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/logifit',
    })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/**
 * Cria member de teste em `academia-equilibrio`. Idempotente — se email já
 * existe, deleta antes (evita acumular nas re-runs locais).
 */
export async function createTestMember(opts: {
  email?: string
  name?: string
  document?: string
}): Promise<TestMember> {
  const email = opts.email ?? `e2e-${Date.now()}@logifit.test`
  const name = opts.name ?? 'E2E Test Member'
  // Document único — usa timestamp + random pra evitar colisão com seed canônico
  // (formato 11 dígitos; CPF check digit não validado em dev seeds).
  const ts = Date.now().toString().slice(-9)
  const rnd = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, '0')
  const document = opts.document ?? `${ts}${rnd}` // 11 dígitos guaranteed unique

  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')

    // Resolve tenant + company
    const tenant = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1`,
      [TEST_TENANT_SLUG],
    )
    if (!tenant.rows[0]) {
      throw new Error(`Tenant '${TEST_TENANT_SLUG}' não existe — rode pnpm db:seed primeiro`)
    }
    const tenantId = tenant.rows[0].id

    const company = await client.query<{ id: string }>(
      `SELECT id FROM companies WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    )
    if (!company.rows[0]) {
      throw new Error(`Sem companies no tenant '${TEST_TENANT_SLUG}'`)
    }
    const companyId = company.rows[0].id

    // Idempotência: limpa member existente do mesmo email (se houver)
    await client.query(
      `DELETE FROM members WHERE tenant_id = $1 AND person_id IN (
         SELECT id FROM persons WHERE tenant_id = $1 AND lower(email) = lower($2)
       )`,
      [tenantId, email],
    )
    await client.query(
      `DELETE FROM persons WHERE tenant_id = $1 AND lower(email) = lower($2)`,
      [tenantId, email],
    )

    // INSERT person + member
    const personRow = await client.query<{ id: string }>(
      `INSERT INTO persons (tenant_id, kind, name, display_name, email, phone, document, birth_date, sex)
       VALUES ($1, 'pf', $2, $3, $4, '11999999999', $5, '1990-01-01', 'F')
       RETURNING id`,
      [tenantId, name, name.split(' ')[0], email, document],
    )
    const personId = personRow.rows[0]!.id

    const memberRow = await client.query<{ id: string }>(
      `INSERT INTO members (tenant_id, person_id, company_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, personId, companyId],
    )
    const memberId = memberRow.rows[0]!.id

    return {
      tenantId,
      tenantSlug: TEST_TENANT_SLUG,
      companyId,
      personId,
      memberId,
      email,
    }
  } finally {
    client.release()
  }
}

/**
 * Apaga member + person criados por `createTestMember`. Tolerante.
 */
export async function deleteTestMember(member: TestMember): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('SET row_security = off')
    await client.query('DELETE FROM member_auth_tokens WHERE member_id = $1', [member.memberId])
    await client.query('DELETE FROM member_sessions WHERE member_id = $1', [member.memberId])
    await client.query('DELETE FROM members WHERE id = $1', [member.memberId])
    await client.query('DELETE FROM persons WHERE id = $1', [member.personId])
  } catch (err) {
    // Tolerante — logging only
    console.warn(
      '[test-member] cleanup falhou:',
      err instanceof Error ? err.message : err,
    )
  } finally {
    client.release()
  }
}
