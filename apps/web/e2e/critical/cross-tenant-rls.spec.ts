import { test } from '@playwright/test'

/**
 * critical/cross-tenant-rls — prova isolamento RLS comportamental (T6 ADR 0090).
 * Bloqueia deploy prod se falhar (ADR 0090 §5 — Top-12 block release).
 *
 * Cenário:
 *   1. tenant A insere member
 *   2. tenant B (mesma rede ou rede distinta) tenta SELECT do member de A
 *   3. resultado deve ser 0 rows — RLS deve bloquear
 *
 * Implementação real depende de helpers/db.ts twoConnectionsTest() + seed
 * de 5 cenários canônicos (Sprint 01a).
 */
test.skip('tenant B não vê dado de tenant A via SELECT direto no DB', async () => {
  // const result = await twoConnectionsTest('rede-propria', async ({ tenantA, tenantB }) => {
  //   await tenantA.query("INSERT INTO members (tenant_id, name) VALUES (current_tenant_id(), 'João')")
  //   const { rows } = await tenantB.query("SELECT * FROM members WHERE name = 'João'")
  //   return rows
  // })
  // expect(result).toHaveLength(0)
})
