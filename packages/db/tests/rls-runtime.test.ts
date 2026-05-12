/**
 * RLS runtime isolation — T6 ADR 0090 (Two-Connections Test).
 *
 * Valida o **comportamento real** das RLS policies usando 2 conexões pg
 * distintas em paralelo:
 *   - conn A com `app.tenant_id` = tenant da Rede Equilíbrio
 *   - conn B com `app.tenant_id` = tenant da BodyTech Franquia
 *   - Ambas rodam SELECT mesma tabela
 *   - Cada uma deve ver SÓ os dados do seu tenant
 *
 * **Pré-requisito**: `pnpm db:seed` populou os 4 cenários canônicos.
 *
 * Sprint 01a Faixa H: cobre persons + companies + units (3 tabelas
 * fundacionais). Sprints donas adicionam tabelas próprias ao mesmo padrão
 * (member, invoice, evolucao, etc).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// UUIDs do seed (`scripts/seed.ts` SCENARIOS) — hardcoded determinísticos
const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'
const TENANT_INEXISTENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

/**
 * Helper: abre uma conexão como `logifit_app` (role do app — sem BYPASSRLS),
 * seta `app.tenant_id`, executa fn, e libera conexão.
 *
 * Cada call usa cliente próprio do pool — simula 2 requests paralelos.
 */
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
      /* ignore cleanup errors */
    }
    client.release()
  }
}

describe('RLS isolamento — persons (regra 1)', () => {
  it('tenant Rede vê APENAS persons da Rede Equilíbrio', async () => {
    const names = await withTenantContext(TENANT_REDE, async (client) => {
      const result = await client.query<{ name: string }>(`SELECT name FROM persons ORDER BY name`)
      return result.rows.map((r) => r.name)
    })
    // Rede tem 3 matriz/filiais (3 persons PJ) + 1 admin (1 persons PF) = 4
    expect(names.length).toBe(4)
    expect(names.every((n) => n.includes('Equilíbrio') || n === 'Admin Rede')).toBe(true)
  })

  it('tenant Franquia vê APENAS persons da BodyTech', async () => {
    const names = await withTenantContext(TENANT_FRANQUIA, async (client) => {
      const result = await client.query<{ name: string }>(`SELECT name FROM persons ORDER BY name`)
      return result.rows.map((r) => r.name)
    })
    // Franquia: 1 franqueador + 2 franqueados (3 persons PJ)
    expect(names.length).toBe(3)
    expect(names.some((n) => n.includes('Franqueado A'))).toBe(true)
    expect(names.some((n) => n.includes('BodyTech'))).toBe(true)
    expect(names.every((n) => !n.includes('Equilíbrio'))).toBe(true)
  })

  it('tenant_id inexistente retorna 0 rows (não vaza nada)', async () => {
    const count = await withTenantContext(TENANT_INEXISTENTE, async (client) => {
      const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text FROM persons`)
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(count).toBe(0)
  })
})

describe('RLS isolamento — companies (regra 1)', () => {
  it('Rede vê 3 companies (1 matriz + 2 filiais); Franquia vê 3 (1 matriz + 2 filiais)', async () => {
    const [redeCount, franqCount] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ count: string }>(`SELECT COUNT(*)::text FROM companies`)
        return Number.parseInt(r.rows[0]?.count ?? '0', 10)
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ count: string }>(`SELECT COUNT(*)::text FROM companies`)
        return Number.parseInt(r.rows[0]?.count ?? '0', 10)
      }),
    ])
    expect(redeCount).toBe(3)
    expect(franqCount).toBe(3)
  })

  it('Rede NÃO vê companies da Franquia (e vice-versa)', async () => {
    // Pega um company_id da Franquia (admin role bypassa pra fazer setup)
    const adminClient = await pool.connect()
    let franquiaCompanyId: string
    try {
      const r = await adminClient.query<{ id: string }>(
        `SELECT id FROM companies WHERE tenant_id = $1 LIMIT 1`,
        [TENANT_FRANQUIA],
      )
      franquiaCompanyId = r.rows[0]?.id ?? ''
    } finally {
      adminClient.release()
    }
    expect(franquiaCompanyId).toBeTruthy()

    // Tenta SELECT da company da Franquia com contexto da Rede → deve retornar 0
    const found = await withTenantContext(TENANT_REDE, async (client) => {
      const r = await client.query<{ id: string }>(`SELECT id FROM companies WHERE id = $1`, [
        franquiaCompanyId,
      ])
      return r.rows
    })
    expect(found).toEqual([])
  })
})

describe('RLS isolamento — units (regra 1)', () => {
  it('cada tenant vê só as próprias units', async () => {
    const [redeUnits, franqUnits] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ name: string }>(
          `SELECT name FROM units ORDER BY name`,
        )
        return r.rows.map((row) => row.name)
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ name: string }>(
          `SELECT name FROM units ORDER BY name`,
        )
        return r.rows.map((row) => row.name)
      }),
    ])
    expect(redeUnits).toHaveLength(3)
    expect(redeUnits.every((n) => n.includes('Unidade'))).toBe(true)
    expect(franqUnits).toHaveLength(3)
    expect(franqUnits.some((n) => n.includes('Franqueador') || n.includes('Franqueado'))).toBe(true)
    // Sem overlap
    const intersection = redeUnits.filter((n) => franqUnits.includes(n))
    expect(intersection).toEqual([])
  })
})

describe('RLS — INSERT cross-tenant bloqueado', () => {
  it('INSERT com tenant_id != app.tenant_id é rejeitado pela WITH CHECK clause', async () => {
    let inserted = false
    let errorMsg = ''

    await withTenantContext(TENANT_REDE, async (client) => {
      try {
        await client.query(
          `INSERT INTO persons (tenant_id, kind, name, document)
           VALUES ($1, 'pf', 'Invasor', '00000000191')`,
          [TENANT_FRANQUIA], // tenta inserir em tenant DIFERENTE do app context
        )
        inserted = true
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err)
      }
    })

    expect(inserted).toBe(false)
    // Mensagem do Postgres: "new row violates row-level security policy"
    expect(errorMsg).toMatch(/row-level security/)
  })
})

describe('RLS — system roles cross-tenant', () => {
  it('roles system (tenant_id NULL) são visíveis a TODOS os tenants', async () => {
    const [redeRoles, franqRoles] = await Promise.all([
      withTenantContext(TENANT_REDE, async (client) => {
        const r = await client.query<{ key: string }>(
          `SELECT key FROM roles WHERE tenant_id IS NULL`,
        )
        return r.rows.map((row) => row.key).sort()
      }),
      withTenantContext(TENANT_FRANQUIA, async (client) => {
        const r = await client.query<{ key: string }>(
          `SELECT key FROM roles WHERE tenant_id IS NULL`,
        )
        return r.rows.map((row) => row.key).sort()
      }),
    ])
    // Ambos veem os mesmos 12 system roles (regra 43 + Faixa C seed)
    expect(redeRoles).toEqual(franqRoles)
    expect(redeRoles).toContain('tenant_owner')
    expect(redeRoles).toContain('medico')
  })
})
