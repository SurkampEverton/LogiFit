import type { BrowserContext } from '@playwright/test'

/**
 * Login programático (não-UI) por persona × cenário (ADR 0090 §8 anti-flakiness).
 * Cacheia storageState por (persona, scenario) em beforeAll de cada describe.
 *
 * Sprint 01a: implementação real via API + cookie httpOnly.
 * Sprint 00: stub que lança — testes que dependem ficam em test.skip().
 */
export type Persona =
  | 'super_admin'
  | 'tenant_owner'
  | 'gerente'
  | 'recepcao'
  | 'fisio'
  | 'nutri'
  | 'member'
  | 'contador_externo'

export type Scenario =
  | 'rede-propria'
  | 'franquia-classica'
  | 'franquia-passaporte'
  | 'mix'
  | 'solo'

export async function loginAs(
  _context: BrowserContext,
  _persona: Persona,
  _scenario: Scenario,
): Promise<void> {
  throw new Error('loginAs() not implemented — Sprint 01a')
}
