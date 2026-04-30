import { expect, test } from '@playwright/test'

/**
 * Template canônico de E2E (ADR 0090 §6).
 *
 * Copie para a suíte apropriada (smoke / critical / regression / a11y / ...),
 * renomeie e implemente. Use helpers em ./helpers/{auth,seed,time,db}.
 *
 * Anti-flakiness (regras de ouro):
 *   - SEM waitForTimeout — use waitForResponse / waitForSelector / waitForLoadState
 *   - SEM new Date() ad-hoc — use freezeAt(page, '2026-04-27T10:00:00-03:00')
 *   - SEM login via UI — use loginAs(persona, scenario) em beforeAll
 *   - SEM URL hardcoded — use page.goto('/') (config define baseURL)
 *   - SEM 'sleep' nos testes — use eventos do app
 */
test.skip('describe: cenário', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/LogiFit/i)
})
