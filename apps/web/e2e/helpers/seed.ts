import type { Scenario } from './auth'

/**
 * loadScenario — carrega 1 dos 5 cenários canônicos do CLAUDE.md em schema PG
 * dedicado por worker (template + clone). ADR 0090 §8 anti-flakiness.
 *
 * Cenários: rede-propria · franquia-classica · franquia-passaporte · mix · solo.
 *
 * Sprint 01a: implementação real via Drizzle + seed scripts. Sprint 00: stub.
 */
export async function loadScenario(_scenario: Scenario): Promise<void> {
  throw new Error('loadScenario() not implemented — Sprint 01a')
}
