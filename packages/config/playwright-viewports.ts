import type { Page } from '@playwright/test'

/**
 * Matriz canônica de viewports para regra 31 (responsividade total mobile-first).
 * 3 canônicos (`iphone-13`, `ipad-portrait`, `desktop-1280`) cobrem 95% dos casos;
 * outros existem para markers `@responsive-extra` em testes específicos.
 */
export const VIEWPORTS = {
  'iphone-13': { width: 390, height: 844 },
  'pixel-5': { width: 393, height: 851 },
  'ipad-portrait': { width: 768, height: 1024 },
  'ipad-landscape': { width: 1024, height: 768 },
  'desktop-1280': { width: 1280, height: 720 },
  'desktop-1920': { width: 1920, height: 1080 },
} as const

export type ViewportName = keyof typeof VIEWPORTS

export const CANONICAL_VIEWPORTS: readonly ViewportName[] = [
  'iphone-13',
  'ipad-portrait',
  'desktop-1280',
] as const

type TestFn = (
  name: string,
  fn: (params: { page: Page }) => Promise<void>,
) => void

export function forEachViewport(
  test: TestFn,
  baseName: string,
  fn: (params: { page: Page; viewport: ViewportName }) => Promise<void>,
  viewports: readonly ViewportName[] = CANONICAL_VIEWPORTS,
): void {
  for (const viewport of viewports) {
    test(`${baseName} @${viewport}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[viewport])
      await fn({ page, viewport })
    })
  }
}
