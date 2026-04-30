/**
 * twoConnectionsTest (T6 ADR 0090) — abre 2 conexões PG distintas com claims
 * JWT diferentes para provar isolamento RLS comportamental (não só estrutural,
 * que o pnpm db:rls-check cobre).
 *
 * Sprint 00: contrato. Implementação real depende de:
 *   - schema com RLS (Sprint 01a)
 *   - 5 cenários canônicos seedados (Sprint 01a)
 *   - JWT claims via set_config('request.jwt.claims', ...) por conexão
 *
 * Uso típico:
 *   await twoConnectionsTest('rede-propria', async ({ tenantA, tenantB }) => {
 *     await tenantA.insert(...)
 *     const rows = await tenantB.select(...)
 *     expect(rows).toHaveLength(0)
 *   })
 */
export interface TenantConnection {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
}

export async function twoConnectionsTest<T>(
  _scenarioName: string,
  _fn: (params: { tenantA: TenantConnection; tenantB: TenantConnection }) => Promise<T>,
): Promise<T> {
  throw new Error('twoConnectionsTest() not implemented — Sprint 01a')
}
