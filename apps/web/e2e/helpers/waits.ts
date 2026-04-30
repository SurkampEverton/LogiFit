/**
 * Padrões anti-flakiness para esperas em E2E (ADR 0090 §8).
 *
 * Proibido em apps/web/e2e/**:
 *   - page.waitForTimeout(N)              — sleep cego, fonte de flakiness
 *   - new Promise(r => setTimeout(r, N))  — idem disfarçado
 *
 * Permitido (em ordem de preferência):
 *   - page.waitForResponse(url|fn)        — espera evento de rede
 *   - page.waitForSelector(sel)           — espera DOM aparecer
 *   - page.waitForLoadState(state)        — networkidle / domcontentloaded
 *   - expect.poll(fn).toBe(...)           — polling com timeout natural
 *   - locator.waitFor({ state })          — espera elemento entrar em estado
 *
 * Helpers customizados (esqueletos — implementação Sprint 01a):
 */
import type { Page } from '@playwright/test'

export type { Page }

/**
 * waitForRequestId — espera response com header `x-request-id` específico.
 * Útil pra rastrear chamadas em fluxos longos com múltiplas Server Actions.
 */
export async function waitForRequestId(_page: Page, _requestId: string): Promise<void> {
  throw new Error('waitForRequestId() not implemented yet — Sprint 01a')
}
