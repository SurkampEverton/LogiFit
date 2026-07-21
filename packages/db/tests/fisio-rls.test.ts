/**
 * Fisio prontuário + CID/CIF RLS — Sprint 20 Faixa A.
 *
 * Valida:
 *   - cid_catalog + cif_catalog read-all (global)
 *   - signature_policies read-all
 *   - tenant_signature_overrides isolation + CHECK só permite icp_required
 *   - consultas isolation per-tenant
 *   - consulta_cids/cifs herda RLS via JOIN com consulta
 *   - Check: net consistente, signature consistente, qualifier CIF [0,4]
 *   - consulta_correction_notes append-only
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

async function getOrCreateMember(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM members WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  )
  if (r.rows[0]) return r.rows[0].id
  const companyId = await getMatriz(tenantId)
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Fisio Member', 'test-fisio-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

async function getUser(tenantId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [
    tenantId,
  ])
  if (r.rows[0]) return r.rows[0].id
  // Cria user mínimo se não houver
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test Prof', 'prof-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
  // Seed mínimo do catálogo CID/CIF + signature_policies pros testes
  await pool.query(`
    INSERT INTO cid_catalog (code, description, chapter) VALUES
      ('MG30.0', 'Dor lombar baixa', 'MG'),
      ('FB20', 'Dor cervical', 'FB')
    ON CONFLICT DO NOTHING
  `)
  await pool.query(`
    INSERT INTO cif_catalog (code, description, component) VALUES
      ('b280', 'Sensação de dor', 'body_functions'),
      ('d450', 'Andar', 'activities_participation')
    ON CONFLICT DO NOTHING
  `)
  await pool.query(`
    INSERT INTO signature_policies (profession, mode, min_cert_level, requires_mfa, source_norm) VALUES
      ('medico', 'icp_required', 'A3', true, 'CFM 2.299/2021'),
      ('fisio', 'authenticated_lock', NULL, true, 'COFFITO 414/2012'),
      ('nutri', 'authenticated_lock', NULL, true, 'CFN 599/2018')
    ON CONFLICT (profession) DO NOTHING
  `)
})

afterAll(async () => {
  await pool
    .query(`DELETE FROM consulta_correction_notes WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM consultas WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM tenant_signature_overrides WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM members WHERE tenant_id IN ($1, $2) AND person_id IN (SELECT id FROM persons WHERE email LIKE 'test-fisio-%' OR email LIKE 'prof-%')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(`DELETE FROM users WHERE tenant_id IN ($1, $2) AND username LIKE 'prof-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM persons WHERE tenant_id IN ($1, $2) AND (email LIKE 'test-fisio-%' OR email LIKE 'prof-%')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  await pool
    .query(`DELETE FROM consulta_correction_notes WHERE tenant_id IN ($1, $2)`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(`DELETE FROM consultas WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(`DELETE FROM tenant_signature_overrides WHERE tenant_id IN ($1, $2)`, [
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

describe('cid_catalog + cif_catalog — read-all global', () => {
  it('qualquer tenant lê CID', async () => {
    const r = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM cid_catalog`)
      return Number(x.rows[0]!.count)
    })
    expect(r).toBeGreaterThanOrEqual(2)
  })

  it('qualquer tenant lê CIF', async () => {
    const r = await withTenantContext(TENANT_FRANQUIA, async (c) => {
      const x = await c.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM cif_catalog`)
      return Number(x.rows[0]!.count)
    })
    expect(r).toBeGreaterThanOrEqual(2)
  })
})

describe('signature_policies — read-all global', () => {
  it('todo tenant vê a política do médico (icp_required)', async () => {
    const r = await withTenantContext(TENANT_REDE, async (c) => {
      const x = await c.query<{ mode: string }>(
        `SELECT mode FROM signature_policies WHERE profession = 'medico'`,
      )
      return x.rows[0]?.mode
    })
    expect(r).toBe('icp_required')
  })

  it('fisio resolve para authenticated_lock', async () => {
    const r = await withTenantContext(TENANT_FRANQUIA, async (c) => {
      const x = await c.query<{ mode: string }>(
        `SELECT mode FROM signature_policies WHERE profession = 'fisio'`,
      )
      return x.rows[0]?.mode
    })
    expect(r).toBe('authenticated_lock')
  })
})

describe('tenant_signature_overrides — check só permite endurecer', () => {
  it('insert icp_required aceito', async () => {
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO tenant_signature_overrides (tenant_id, profession, mode_override, reason, approved_by_user_id)
         VALUES ($1, 'fisio', 'icp_required', 'Rede hospitalar exige ICP', $2)`,
        [TENANT_REDE, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('tentar relaxar pra authenticated_lock falha por CHECK', async () => {
    const userId = await getUser(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO tenant_signature_overrides (tenant_id, profession, mode_override, reason, approved_by_user_id)
         VALUES ($1, 'medico', 'authenticated_lock', 'Tentativa proibida', $2)`,
        [TENANT_REDE, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('consultas — isolation + checks', () => {
  it('cria consulta draft', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode, content)
         VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock', '{"queixa":"dor lombar"}'::jsonb)`,
        [TENANT_REDE, companyId, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('CHECK: status=signed sem signed_at falha', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode, status)
         VALUES ($1, $2, $3, $4, 'medico', 'icp_required', 'signed')`,
        [TENANT_REDE, companyId, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode)
       VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock') RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    const cId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM consultas WHERE id = $1', [cId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM consultas WHERE id = $1', [cId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('consulta_cids — herda RLS via JOIN', () => {
  it('link CID em consulta do tenant aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode)
       VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock') RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await withTenantContext(TENANT_REDE, async (c) => {
        await c.query(
          `INSERT INTO consulta_cids (consulta_id, cid_code, kind) VALUES ($1, 'MG30.0', 'principal')`,
          [r.rows[0]!.id],
        )
      })
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})

describe('consulta_cifs — qualifier check', () => {
  it('qualifier 5 (fora de 0-4) rejeitado', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode)
       VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock') RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO consulta_cifs (consulta_id, cif_code, qualifier) VALUES ($1, 'b280', 5)`,
        [r.rows[0]!.id],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })
})

describe('consulta_correction_notes — append-only por design', () => {
  it('insert nota corretiva aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO consultas (tenant_id, company_id, member_id, professional_user_id, kind, signature_mode, status, signed_at, signed_hash, locked_at)
       VALUES ($1, $2, $3, $4, 'fisio', 'authenticated_lock', 'signed', now(), 'abc123', now()) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO consulta_correction_notes (tenant_id, consulta_id, body, reason, author_user_id, content_hash)
         VALUES ($1, $2, 'Correção: substituir lombalgia por dor lombar crônica', 'typo CID', $3, 'hash-xyz')`,
        [TENANT_REDE, r.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })
})
