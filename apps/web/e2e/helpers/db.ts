/**
 * twoConnectionsTest (T6 ADR 0090) — abre 2 conexões PG distintas com
 * `app.tenant_id` diferentes para provar isolamento RLS comportamental
 * (não só estrutural, que `pnpm db:rls-check` cobre).
 *
 * **Como funciona:**
 *   1. Cria um pool `pg` próprio (não reusa o `@repo/db/client` global pra
 *      garantir conexões independentes do app)
 *   2. Reserva 2 PoolClients distintos
 *   3. Aplica `SELECT set_config('app.tenant_id', $1, false)` em cada um
 *   4. Entrega ambos pra callback `fn`
 *   5. Limpa o setting e libera os clients no `finally`
 *
 * **Pré-condição:**
 *   - `DATABASE_URL` env apontando pro PG local (ou dedicado de teste)
 *   - Tabelas com RLS ENABLE + policies usando `current_setting('app.tenant_id')`
 *
 * @example
 *   await twoConnectionsTest(
 *     '00000000-0000-0000-0000-000000000001',
 *     '00000000-0000-0000-0000-000000000002',
 *     async ({ tenantA, tenantB }) => {
 *       await tenantA.query("INSERT INTO members (tenant_id, ...) VALUES (...)")
 *       const { rows } = await tenantB.query("SELECT * FROM members")
 *       expect(rows).toHaveLength(0) // tenantB não vê tenantA
 *     },
 *   )
 */
import { Pool, type PoolClient } from 'pg'

export interface TenantConnection {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function wrapClient(client: PoolClient): TenantConnection {
  return {
    async query(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params as unknown[])
      return { rows: result.rows as unknown[] }
    },
  }
}

export async function twoConnectionsTest<T>(
  tenantIdA: string,
  tenantIdB: string,
  fn: (params: { tenantA: TenantConnection; tenantB: TenantConnection }) => Promise<T>,
): Promise<T> {
  if (!UUID_REGEX.test(tenantIdA) || !UUID_REGEX.test(tenantIdB)) {
    throw new Error('twoConnectionsTest: tenantIdA/B precisam ser UUIDs válidos')
  }
  if (tenantIdA === tenantIdB) {
    throw new Error('twoConnectionsTest: tenantIdA === tenantIdB — pega 2 distintos para testar isolamento')
  }
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('twoConnectionsTest: DATABASE_URL env obrigatória')
  }

  const pool = new Pool({ connectionString, max: 2 })
  let clientA: PoolClient | null = null
  let clientB: PoolClient | null = null
  try {
    clientA = await pool.connect()
    clientB = await pool.connect()
    await clientA.query("SELECT set_config('app.tenant_id', $1, false)", [tenantIdA])
    await clientB.query("SELECT set_config('app.tenant_id', $1, false)", [tenantIdB])
    return await fn({
      tenantA: wrapClient(clientA),
      tenantB: wrapClient(clientB),
    })
  } finally {
    if (clientA) {
      await clientA.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
      clientA.release()
    }
    if (clientB) {
      await clientB.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
      clientB.release()
    }
    await pool.end().catch(() => {})
  }
}
