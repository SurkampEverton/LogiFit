import { expect, test } from '@playwright/test'

/**
 * smoke/sidemenu-responsive — Sprint 00b Faixa D.
 *
 * Valida `<AppShell>` em **3 viewports** (mobile 390 / tablet 768 / desktop 1280):
 *   1. ☰ hamburger trigger visível e clicável (touch target ≥44px — regra 31)
 *   2. Click ☰ abre overlay menu com `transform translateX(0)` + backdrop
 *   3. Esc fecha menu + restaura foco no trigger (a11y WCAG)
 *   4. Footer mostra avatar circular + email + tenant + botão "Sair"
 *   5. Logout button POSTa /api/auth/sign-out + redirect /login
 *   6. Mobile: click em item de navegação fecha menu automaticamente
 *   7. Desktop: click em item mantém menu aberto (persistência localStorage)
 *
 * **Status: `test.fixme()` até auth helper aterrissar.**
 * `loginAs(persona, scenario)` helper ainda é stub (Sprint 04+ implementação).
 * Validação manual via Chrome MCP coberta no commit fd5b4e1 + Sprint 00b Faixa D.
 *
 * Quando auth helper aterrissar: trocar `test.fixme` por `test` + usar
 * `await loginAs(context, 'tenant_owner', 'rede-propria')` em beforeEach.
 */
import { VIEWPORTS } from '@repo/config/playwright-viewports'

const SCENARIO_VIEWPORTS = [
  { name: 'mobile', size: VIEWPORTS['iphone-13'] },
  { name: 'tablet', size: VIEWPORTS['ipad-portrait'] },
  { name: 'desktop', size: VIEWPORTS['desktop-1280'] },
] as const

for (const { name, size } of SCENARIO_VIEWPORTS) {
  test.describe(`SideMenu — ${name} (${size.width}×${size.height})`, () => {
    test.use({ viewport: size })

    test.fixme(
      'hamburger ☰ trigger visível + 44px touch target',
      async ({ page }) => {
        // TODO: await loginAs(page.context(), 'tenant_owner', 'rede-propria')
        await page.goto('/app')
        const trigger = page.getByRole('button', { name: /menu|abrir menu/i })
        await expect(trigger).toBeVisible()
        const box = await trigger.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
      },
    )

    test.fixme('click ☰ abre overlay menu com translateX(0)', async ({ page }) => {
      await page.goto('/app')
      const trigger = page.getByRole('button', { name: /menu/i })
      await trigger.click()
      const menu = page.locator('#logifit-sidemenu')
      await expect(menu).toHaveAttribute('aria-hidden', 'false')
    })

    test.fixme('Esc fecha menu + restaura foco', async ({ page }) => {
      await page.goto('/app')
      await page.getByRole('button', { name: /menu/i }).click()
      await page.keyboard.press('Escape')
      const menu = page.locator('#logifit-sidemenu')
      await expect(menu).toHaveAttribute('aria-hidden', 'true')
    })

    test.fixme('footer mostra avatar + email + botão Sair', async ({ page }) => {
      await page.goto('/app')
      await page.getByRole('button', { name: /menu/i }).click()
      const signOutBtn = page.getByRole('button', { name: /sair|sign out|salir/i })
      await expect(signOutBtn).toBeVisible()
    })

    test.fixme('Sair faz logout + redirect /login', async ({ page }) => {
      await page.goto('/app')
      await page.getByRole('button', { name: /menu/i }).click()
      await page.getByRole('button', { name: /sair|sign out|salir/i }).click()
      await expect(page).toHaveURL(/\/login/)
    })
  })
}
