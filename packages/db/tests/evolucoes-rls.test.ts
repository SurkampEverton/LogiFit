/**
 * Evoluções de sessão + anexos RLS + constraints — Sprint 21 Faixa A.
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
     VALUES ($1, 'pf', 'Test Evol', 'test-evol-' || $1::uuid::text || '@example.com') RETURNING id`,
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
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Prof Evol', 'prof-evol-' || $1::uuid::text || '@example.com') RETURNING id`,
    [tenantId],
  )
  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, person_id, username) VALUES ($1, $2, 'prof-evol-' || $1::uuid::text) RETURNING id`,
    [tenantId, p.rows[0]!.id],
  )
  return u.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of ['evolucao_attachments', 'evolucoes_sessao']) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(
      `DELETE FROM members WHERE tenant_id IN ($1, $2) AND person_id IN (SELECT id FROM persons WHERE email LIKE 'test-evol-%' OR email LIKE 'prof-evol-%')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool
    .query(`DELETE FROM users WHERE tenant_id IN ($1, $2) AND username LIKE 'prof-evol-%'`, [
      TENANT_REDE,
      TENANT_FRANQUIA,
    ])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM persons WHERE tenant_id IN ($1, $2) AND (email LIKE 'test-evol-%' OR email LIKE 'prof-evol-%')`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of ['evolucao_attachments', 'evolucoes_sessao']) {
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

describe('evolucoes_sessao — isolation + checks', () => {
  it('insert draft válido', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id, soap, free_text)
         VALUES ($1, $2, $3, $4, '{"subjetivo":"dor diminuiu"}'::jsonb, 'tolerou bem')`,
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
        `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id, status)
         VALUES ($1, $2, $3, $4, 'signed')`,
        [TENANT_REDE, companyId, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('CHECK: status=locked sem locked_at falha', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id, status)
         VALUES ($1, $2, $3, $4, 'locked')`,
        [TENANT_REDE, companyId, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('appointment_id NULL aceita N evoluções (não-vinculadas)', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
         VALUES ($1, $2, $3, $4), ($1, $2, $3, $4)`,
        [TENANT_REDE, companyId, memberId, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('isolation: Rede vê; Franquia não vê', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    const eId = r.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM evolucoes_sessao WHERE id = $1', [eId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM evolucoes_sessao WHERE id = $1', [eId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})

describe('evolucao_attachments — checks + status flow', () => {
  it('insert anexo válido (status default pending)', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucao_attachments (tenant_id, evolucao_id, kind, storage_path, filename, size_bytes, mime_type, uploaded_by_user_id)
         VALUES ($1, $2, 'exame_imagem', 'tenants/x/y.jpg', 'raio-x.jpg', 1024000, 'image/jpeg', $3)`,
        [TENANT_REDE, ev.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('CHECK: size > 50MB rejeitado', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucao_attachments (tenant_id, evolucao_id, kind, storage_path, filename, size_bytes, mime_type, uploaded_by_user_id)
         VALUES ($1, $2, 'video_execucao', 'tenants/x/v.mp4', 'video.mp4', 60000000, 'video/mp4', $3)`,
        [TENANT_REDE, ev.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('CHECK: size 0 rejeitado', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO evolucao_attachments (tenant_id, evolucao_id, kind, storage_path, filename, size_bytes, mime_type, uploaded_by_user_id)
         VALUES ($1, $2, 'documento', 'tenants/x/empty.pdf', 'empty.pdf', 0, 'application/pdf', $3)`,
        [TENANT_REDE, ev.rows[0]!.id, userId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23514')
  })

  it('UPDATE scan_status pending → clean aceito', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    const at = await pool.query<{ id: string; scan_status: string }>(
      `INSERT INTO evolucao_attachments (tenant_id, evolucao_id, kind, storage_path, filename, size_bytes, mime_type, uploaded_by_user_id)
       VALUES ($1, $2, 'foto_postural', 'tenants/x/p.jpg', 'p.jpg', 500000, 'image/jpeg', $3)
       RETURNING id, scan_status`,
      [TENANT_REDE, ev.rows[0]!.id, userId],
    )
    expect(at.rows[0]!.scan_status).toBe('pending')
    await pool.query(`UPDATE evolucao_attachments SET scan_status = 'clean' WHERE id = $1`, [
      at.rows[0]!.id,
    ])
    const after = await pool.query<{ scan_status: string }>(
      `SELECT scan_status FROM evolucao_attachments WHERE id = $1`,
      [at.rows[0]!.id],
    )
    expect(after.rows[0]!.scan_status).toBe('clean')
  })

  it('isolation: anexo do tenant rede não visível pra franquia', async () => {
    const memberId = await getOrCreateMember(TENANT_REDE)
    const userId = await getUser(TENANT_REDE)
    const companyId = await getMatriz(TENANT_REDE)
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO evolucoes_sessao (tenant_id, company_id, member_id, professional_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_REDE, companyId, memberId, userId],
    )
    const at = await pool.query<{ id: string }>(
      `INSERT INTO evolucao_attachments (tenant_id, evolucao_id, kind, storage_path, filename, size_bytes, mime_type, uploaded_by_user_id)
       VALUES ($1, $2, 'documento', 'tenants/x/iso.pdf', 'iso.pdf', 12345, 'application/pdf', $3)
       RETURNING id`,
      [TENANT_REDE, ev.rows[0]!.id, userId],
    )
    const aId = at.rows[0]!.id
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM evolucao_attachments WHERE id = $1', [aId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM evolucao_attachments WHERE id = $1', [aId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })
})
