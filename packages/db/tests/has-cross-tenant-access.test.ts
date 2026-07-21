/**
 * Tests da função SQL `has_cross_tenant_access()` — Sprint 02 fechamento
 * (regra 42 + ADR 0077 + policy 0055_has_cross_tenant_access.sql).
 *
 * 6 cenários canônicos:
 *   1. Vínculo ativo + módulo ativo + nível cobre categoria → TRUE
 *   2. Vínculo revogado → FALSE
 *   3. Módulo inativo (substituído/revogado) → FALSE
 *   4. Categoria fora do data_level autorizado → FALSE
 *   5. Categoria em limite duro (financeiro) → FALSE sempre
 *   6. Workspace (nível 5) → FALSE sempre
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TENANT_READER = '00000001-0001-0000-0000-000000000010' // rede própria
const TENANT_SOURCE = '00000003-0001-0000-0000-000000000010' // outro tenant

let pool: Pool
let passportId: string
let readerUserId: string

async function getOrCreateUser(tenantId: string, label: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND username LIKE $2 LIMIT 1`,
    [tenantId, `test-${label}-%`],
  )
  if (r.rows[0]) return r.rows[0].id
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', $2, 'test-' || $3 || '-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId, `Test ${label}`, label],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'test-' || $3 || '-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id, label],
  )
  return u.rows[0]!.id
}

async function createLink(opts: {
  status: 'active' | 'pending' | 'revoked'
  revokedAt?: Date | null
}): Promise<string> {
  const personId = (
    await pool.query<{ id: string }>(
      `INSERT INTO persons (tenant_id, kind, name, email)
       VALUES ($1, 'pf', 'Passport Patient', 'passport-' || gen_random_uuid()::text || '@example.com') RETURNING id`,
      [TENANT_READER],
    )
  ).rows[0]!.id

  const r = await pool.query<{ id: string }>(
    `INSERT INTO patient_company_links
     (passport_passport_id, person_id, tenant_id, status, creation_path, accepted_at, revoked_at)
     VALUES ($1, $2, $3, $4::passport_link_status, 'reactive', $5, $6) RETURNING id`,
    [
      passportId,
      personId,
      TENANT_READER,
      opts.status,
      opts.status === 'active' ? new Date() : null,
      opts.revokedAt ?? null,
    ],
  )
  return r.rows[0]!.id
}

async function createLinkModule(
  linkId: string,
  module: 'academia' | 'fisioterapia' | 'nutricao' | 'pilates' | 'personal_training',
  opts: {
    status: 'active' | 'pending' | 'inactive'
    dataLevels: {
      identidade?: boolean
      antropometria?: boolean
      treino?: boolean
      clinico?: boolean
    }
    deactivatedAt?: Date | null
  },
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO patient_link_modules
     (link_id, passport_passport_id, module, status, data_levels, activated_at, deactivated_at)
     VALUES ($1, $2, $3::passport_module, $4::passport_module_status, $5::jsonb, $6, $7) RETURNING id`,
    [
      linkId,
      passportId,
      module,
      opts.status,
      JSON.stringify(opts.dataLevels),
      opts.status === 'active' ? new Date() : null,
      opts.deactivatedAt ?? null,
    ],
  )
  return r.rows[0]!.id
}

async function callHasAccess(
  passport: string,
  module: 'academia' | 'fisioterapia' | 'nutricao' | 'pilates' | 'personal_training',
  category: string,
): Promise<boolean> {
  const r = await pool.query<{ has: boolean }>(
    `SELECT has_cross_tenant_access($1, $2, $3, $4::passport_module, $5) AS has`,
    [readerUserId, TENANT_READER, passport, module, category],
  )
  return r.rows[0]!.has
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  readerUserId = await getOrCreateUser(TENANT_READER, 'cross-tenant-reader')
})

afterAll(async () => {
  await pool
    .query(`DELETE FROM patient_link_modules WHERE passport_passport_id = $1`, [passportId])
    .catch(() => {})
  await pool
    .query(`DELETE FROM patient_company_links WHERE passport_passport_id = $1`, [passportId])
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  // Fresh passport per test pra evitar constraint global (1 módulo ativo)
  passportId = (await pool.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id
})

describe('has_cross_tenant_access — 6 cenários canônicos', () => {
  it('1. vínculo ativo + módulo ativo + nível cobre categoria → TRUE', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'fisioterapia', {
      status: 'active',
      dataLevels: { identidade: true, antropometria: true, treino: true, clinico: true },
    })
    const r = await callHasAccess(passportId, 'fisioterapia', 'clinico')
    expect(r).toBe(true)
  })

  it('2. vínculo revogado → FALSE', async () => {
    const linkId = await createLink({ status: 'revoked', revokedAt: new Date() })
    await createLinkModule(linkId, 'fisioterapia', {
      status: 'active',
      dataLevels: { identidade: true, clinico: true },
    })
    const r = await callHasAccess(passportId, 'fisioterapia', 'clinico')
    expect(r).toBe(false)
  })

  it('3. módulo inativo (substituído) → FALSE', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'academia', {
      status: 'inactive',
      dataLevels: { identidade: true, antropometria: true },
      deactivatedAt: new Date(),
    })
    const r = await callHasAccess(passportId, 'academia', 'antropometria')
    expect(r).toBe(false)
  })

  it('4. categoria não autorizada no data_levels → FALSE', async () => {
    const linkId = await createLink({ status: 'active' })
    // paciente liberou só identidade+antropometria mas profissional tenta ler clinico
    await createLinkModule(linkId, 'nutricao', {
      status: 'active',
      dataLevels: { identidade: true, antropometria: true, clinico: false },
    })
    const r = await callHasAccess(passportId, 'nutricao', 'clinico')
    expect(r).toBe(false)
  })

  it('5. limite duro financeiro → FALSE mesmo com vínculo perfeito', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'academia', {
      status: 'active',
      dataLevels: { identidade: true, antropometria: true, treino: true, clinico: true },
    })
    const r = await callHasAccess(passportId, 'academia', 'financeiro')
    expect(r).toBe(false)
  })

  it('6. workspace (Nível 5) → FALSE mesmo com vínculo perfeito', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'fisioterapia', {
      status: 'active',
      dataLevels: { identidade: true, clinico: true, workspace: true } as never, // workspace tentado
    })
    const r = await callHasAccess(passportId, 'fisioterapia', 'workspace')
    expect(r).toBe(false)
  })

  it('7. prontuario_cfm_bruto (limite duro) → FALSE', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'fisioterapia', {
      status: 'active',
      dataLevels: { identidade: true, clinico: true },
    })
    const r = await callHasAccess(passportId, 'fisioterapia', 'prontuario_cfm_bruto')
    expect(r).toBe(false)
  })

  it('8. terceiros_mencionados (limite duro) → FALSE', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'fisioterapia', {
      status: 'active',
      dataLevels: { identidade: true, clinico: true },
    })
    const r = await callHasAccess(passportId, 'fisioterapia', 'terceiros_mencionados')
    expect(r).toBe(false)
  })

  it('9. categoria desconhecida → FALSE (fail closed)', async () => {
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'academia', {
      status: 'active',
      dataLevels: { identidade: true, antropometria: true, treino: true },
    })
    const r = await callHasAccess(passportId, 'academia', 'categoria_inexistente')
    expect(r).toBe(false)
  })

  it('10. sem vínculo nenhum → FALSE', async () => {
    // passport novo sem link nenhum
    const r = await callHasAccess(passportId, 'fisioterapia', 'identidade')
    expect(r).toBe(false)
  })

  // Sanity: TENANT_SOURCE diferente do reader — só pra documentar futura
  // expansão Sprint 02b quando categorias granulares por reader user forem
  // adicionadas.
  it('TENANT_SOURCE sanity — diff entre reader e source não afeta a função MVP', async () => {
    void TENANT_SOURCE
    const linkId = await createLink({ status: 'active' })
    await createLinkModule(linkId, 'pilates', {
      status: 'active',
      dataLevels: { identidade: true, treino: true },
    })
    const r = await callHasAccess(passportId, 'pilates', 'treino')
    expect(r).toBe(true)
  })
})
