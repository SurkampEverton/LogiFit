/**
 * Roteamento de conexão por contexto (ADR 0107) — a prova de que a RLS flui.
 *
 * O bug histórico: `set_config('app.tenant_id')` numa conexão e as queries do
 * Drizzle em OUTRA conexão do pool — RLS inerte no app inteiro. O conserto
 * roteia o `db` global pra conexão contextualizada via AsyncLocalStorage.
 *
 * Estes testes replicam exatamente o que `withSessionContext` (apps/web) faz:
 * checkout + SET ROLE logifit_app + set_config + runWithDbClient.
 */
import { eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool, runWithDbClient } from '../src/client'
import { persons } from '../src/schema'

const TENANT_REDE = '00000001-0001-0000-0000-000000000010'
const TENANT_FRANQUIA = '00000002-0001-0000-0000-000000000010'

afterAll(async () => {
  await pool.end()
})

/** O mesmo preparo que withSessionContext faz no app. */
async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('SET ROLE logifit_app')
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId])
    return await runWithDbClient(client, fn)
  } finally {
    try {
      await client.query('RESET ROLE')
      await client.query("SELECT set_config('app.tenant_id', '', false)")
    } catch {
      /* swallow */
    }
    client.release()
  }
}

describe('runWithDbClient — RLS através do db global', () => {
  it('db.select dentro do contexto só vê o tenant — sem filtro explícito na query', async () => {
    const rows = await withTenant(TENANT_REDE, async () => {
      // Deliberadamente SEM eq(persons.tenantId, ...) — é a RLS que filtra
      return db.select({ tenantId: persons.tenantId, name: persons.name }).from(persons)
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.tenantId === TENANT_REDE)).toBe(true)
  })

  it('fora do contexto o pool segue sem escopo (superusuário) — roteamento não vaza', async () => {
    const rows = await db
      .select({ tenantId: persons.tenantId })
      .from(persons)
      .where(eq(persons.tenantId, TENANT_FRANQUIA))
    // Se o SET ROLE/config tivesse vazado da conexão do teste anterior,
    // esta query não veria a Franquia.
    expect(rows.length).toBeGreaterThan(0)
  })

  it('db.transaction dentro do contexto roda na MESMA conexão', async () => {
    const setting = await withTenant(TENANT_REDE, async () => {
      return db.transaction(async (tx) => {
        const r = await tx.execute<{ v: string }>(
          // biome-ignore lint/style/noUnusedTemplateLiteral: sql tag do drizzle
          (await import('drizzle-orm')).sql`SELECT current_setting('app.tenant_id', true) AS v`,
        )
        return (r.rows as Array<{ v: string }>)[0]?.v
      })
    })
    // Se a transação tivesse aberto conexão nova do pool, o setting seria '' —
    // e o BEGIN/COMMIT rodaria fora do papel logifit_app.
    expect(setting).toBe(TENANT_REDE)
  })

  it('queries paralelas dentro do contexto serializam na conexão sem corromper', async () => {
    const results = await withTenant(TENANT_REDE, async () => {
      return Promise.all([
        db.select({ tenantId: persons.tenantId }).from(persons),
        db.select({ tenantId: persons.tenantId }).from(persons),
        db.select({ tenantId: persons.tenantId }).from(persons),
      ])
    })
    for (const rows of results) {
      expect(rows.every((r) => r.tenantId === TENANT_REDE)).toBe(true)
    }
  })

  it('contextos aninhados em tenants distintos não se contaminam', async () => {
    const [redeRows, franqRows] = await Promise.all([
      withTenant(TENANT_REDE, () => db.select({ tenantId: persons.tenantId }).from(persons)),
      withTenant(TENANT_FRANQUIA, () => db.select({ tenantId: persons.tenantId }).from(persons)),
    ])
    expect(redeRows.every((r) => r.tenantId === TENANT_REDE)).toBe(true)
    expect(franqRows.every((r) => r.tenantId === TENANT_FRANQUIA)).toBe(true)
  })
})
