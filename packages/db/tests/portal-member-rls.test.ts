/**
 * Portal do Paciente RLS + checks — Sprint 26 Faixa A.
 *
 * Cobre member_auth_tokens + member_sessions + member_consents:
 *   - isolamento por tenant_id
 *   - membro vê próprios dados (app.member_id)
 *   - token_hash unique global
 *   - UPDATE permitido (used_at, revoked_at, last_seen_at)
 *   - consent 1 ativo por (member, purpose)
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

async function createMember(tenantId: string, label: string): Promise<string> {
  const companyId = await getMatriz(tenantId)
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (tenant_id, kind, name, email)
     VALUES ($1, 'pf', 'Test ' || $2, 'seed-portal-' || $2 || '-' || $1::uuid::text || '@example.com')
     RETURNING id`,
    [tenantId, label],
  )
  const m = await pool.query<{ id: string }>(
    `INSERT INTO members (tenant_id, person_id, company_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, p.rows[0]!.id, companyId],
  )
  return m.rows[0]!.id
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  for (const tbl of ['member_consents', 'member_sessions', 'member_auth_tokens']) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(`DELETE FROM members WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'seed-portal-%'`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
    .catch(() => {})
  await pool.end()
})

beforeEach(async () => {
  for (const tbl of ['member_consents', 'member_sessions', 'member_auth_tokens']) {
    await pool
      .query(`DELETE FROM ${tbl} WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
      .catch(() => {})
  }
  await pool
    .query(`DELETE FROM members WHERE tenant_id IN ($1, $2)`, [TENANT_REDE, TENANT_FRANQUIA])
    .catch(() => {})
  await pool
    .query(
      `DELETE FROM persons WHERE tenant_id IN ($1, $2) AND email LIKE 'seed-portal-%'`,
      [TENANT_REDE, TENANT_FRANQUIA],
    )
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

async function withMemberContext<T>(
  memberId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('SET ROLE logifit_app')
    // Member context sempre seta ambos — JWT do member carrega tenant_id + member_id
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId])
    await client.query("SELECT set_config('app.member_id', $1, false)", [memberId])
    return await fn(client)
  } finally {
    try {
      await client.query("SELECT set_config('app.tenant_id', '', false)")
      await client.query("SELECT set_config('app.member_id', '', false)")
      await client.query('RESET ROLE')
    } catch {
      /* ignore */
    }
    client.release()
  }
}

describe('member_auth_tokens — isolation + unique', () => {
  it('insert OK + tenant isolation', async () => {
    const memberId = await createMember(TENANT_REDE, 'auth1')
    let errCode = ''
    let insertedId = ''
    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at, request_ip)
         VALUES ($1, $2, 'hash-abc-' || gen_random_uuid()::text, now() + interval '15 min', '127.0.0.1')
         RETURNING id`,
        [TENANT_REDE, memberId],
      )
      insertedId = r.rows[0]!.id
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
    expect(insertedId).not.toBe('')

    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM member_auth_tokens WHERE id = $1', [insertedId])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM member_auth_tokens WHERE id = $1', [insertedId])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('token_hash duplicado rejeitado globalmente', async () => {
    const memberA = await createMember(TENANT_REDE, 'dup1')
    const memberB = await createMember(TENANT_FRANQUIA, 'dup2')
    const sameHash = 'COLLISION-HASH-' + Date.now()
    await pool.query(
      `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 min')`,
      [TENANT_REDE, memberA, sameHash],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '15 min')`,
        [TENANT_FRANQUIA, memberB, sameHash],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('member context vê próprios tokens via member_id', async () => {
    const memberId = await createMember(TENANT_REDE, 'memctx')
    const r = await pool.query<{ id: string }>(
      `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at)
       VALUES ($1, $2, 'hash-mem-' || gen_random_uuid()::text, now() + interval '15 min')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const count = await withMemberContext(memberId, TENANT_REDE, async (c) => {
      const x = await c.query('SELECT id FROM member_auth_tokens WHERE id = $1', [r.rows[0]!.id])
      return x.rows.length
    })
    expect(count).toBe(1)
  })

  it('UPDATE used_at permitido (single-use mark)', async () => {
    const memberId = await createMember(TENANT_REDE, 'used1')
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO member_auth_tokens (tenant_id, member_id, token_hash, expires_at)
       VALUES ($1, $2, 'hash-used-' || gen_random_uuid()::text, now() + interval '15 min')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const r = await withTenantContext(TENANT_REDE, async (c) => {
      return c.query(`UPDATE member_auth_tokens SET used_at = now() WHERE id = $1`, [
        ins.rows[0]!.id,
      ])
    })
    expect(r.rowCount).toBe(1)
  })
})

describe('member_sessions — refresh + revoke', () => {
  it('insert OK + tenant isolation', async () => {
    const memberId = await createMember(TENANT_REDE, 'sess1')
    const r = await pool.query<{ id: string }>(
      `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at, device_label)
       VALUES ($1, $2, 'rt-' || gen_random_uuid()::text, now() + interval '30 days', 'iPhone 15')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM member_sessions WHERE id = $1', [r.rows[0]!.id])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM member_sessions WHERE id = $1', [r.rows[0]!.id])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('refresh_token_hash unique global', async () => {
    const memberA = await createMember(TENANT_REDE, 'srt1')
    const memberB = await createMember(TENANT_FRANQUIA, 'srt2')
    const sameHash = 'RT-COLLISION-' + Date.now()
    await pool.query(
      `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [TENANT_REDE, memberA, sameHash],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [TENANT_FRANQUIA, memberB, sameHash],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('UPDATE last_seen_at + revoked_at permitido', async () => {
    const memberId = await createMember(TENANT_REDE, 'rev1')
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, 'rt-rev-' || gen_random_uuid()::text, now() + interval '30 days')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const r = await withTenantContext(TENANT_REDE, async (c) => {
      return c.query(
        `UPDATE member_sessions
         SET last_seen_at = now(), revoked_at = now(), revoked_reason = 'logout'
         WHERE id = $1`,
        [ins.rows[0]!.id],
      )
    })
    expect(r.rowCount).toBe(1)
  })

  it('member context UPDATE próprias sessões (logout self)', async () => {
    const memberId = await createMember(TENANT_REDE, 'mlogout')
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO member_sessions (tenant_id, member_id, refresh_token_hash, expires_at)
       VALUES ($1, $2, 'rt-self-' || gen_random_uuid()::text, now() + interval '30 days')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const r = await withMemberContext(memberId, TENANT_REDE, async (c) => {
      return c.query(`UPDATE member_sessions SET revoked_at = now() WHERE id = $1`, [
        ins.rows[0]!.id,
      ])
    })
    expect(r.rowCount).toBe(1)
  })
})

describe('member_consents — 1 ativo por purpose + revoke', () => {
  it('insert OK + isolation', async () => {
    const memberId = await createMember(TENANT_REDE, 'csn1')
    const r = await pool.query<{ id: string }>(
      `INSERT INTO member_consents (tenant_id, member_id, purpose, granted, ripd_version, source_ip)
       VALUES ($1, $2, 'marketing', true, 'v1.0', '127.0.0.1')
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const [redeVisible, franqVisible] = await Promise.all([
      withTenantContext(TENANT_REDE, async (c) => {
        const x = await c.query('SELECT id FROM member_consents WHERE id = $1', [r.rows[0]!.id])
        return x.rows.length
      }),
      withTenantContext(TENANT_FRANQUIA, async (c) => {
        const x = await c.query('SELECT id FROM member_consents WHERE id = $1', [r.rows[0]!.id])
        return x.rows.length
      }),
    ])
    expect(redeVisible).toBe(1)
    expect(franqVisible).toBe(0)
  })

  it('2 consents ativos mesmo (member, purpose) rejeitado', async () => {
    const memberId = await createMember(TENANT_REDE, 'csn2')
    await pool.query(
      `INSERT INTO member_consents (tenant_id, member_id, purpose, granted)
       VALUES ($1, $2, 'cross_module_share', true)`,
      [TENANT_REDE, memberId],
    )
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_consents (tenant_id, member_id, purpose, granted)
         VALUES ($1, $2, 'cross_module_share', false)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('23505')
  })

  it('após revoked_at, novo consent permitido (re-grant)', async () => {
    const memberId = await createMember(TENANT_REDE, 'csn3')
    const first = await pool.query<{ id: string }>(
      `INSERT INTO member_consents (tenant_id, member_id, purpose, granted)
       VALUES ($1, $2, 'analytics_anon', true)
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    // revoga o primeiro
    await pool.query(`UPDATE member_consents SET revoked_at = now() WHERE id = $1`, [
      first.rows[0]!.id,
    ])
    // novo grant permitido
    let errCode = ''
    try {
      await pool.query(
        `INSERT INTO member_consents (tenant_id, member_id, purpose, granted)
         VALUES ($1, $2, 'analytics_anon', true)`,
        [TENANT_REDE, memberId],
      )
    } catch (err) {
      errCode = (err as { code?: string }).code ?? ''
    }
    expect(errCode).toBe('')
  })

  it('member context revoga próprio consent', async () => {
    const memberId = await createMember(TENANT_REDE, 'csnself')
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO member_consents (tenant_id, member_id, purpose, granted)
       VALUES ($1, $2, 'photo_use', true)
       RETURNING id`,
      [TENANT_REDE, memberId],
    )
    const r = await withMemberContext(memberId, TENANT_REDE, async (c) => {
      return c.query(`UPDATE member_consents SET revoked_at = now() WHERE id = $1`, [
        ins.rows[0]!.id,
      ])
    })
    expect(r.rowCount).toBe(1)
  })
})
