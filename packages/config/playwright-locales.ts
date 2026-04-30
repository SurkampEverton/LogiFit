import { LOCALES, type Locale } from '@repo/i18n/config'
import type { BrowserContext, Page } from '@playwright/test'

/**
 * forEachLocale (ADR 0052 — extensibilidade i18n). Adicionar locale futuro
 * herda smoke automaticamente: zero edição em testes.
 *
 * Helper seta cookie NEXT_LOCALE no context antes do teste, que combina com
 * o middleware da app (cookie → next-intl getRequestConfig).
 */
type TestFn = (
  name: string,
  fn: (params: { page: Page; context: BrowserContext }) => Promise<void>,
) => void

export function forEachLocale(
  test: TestFn,
  baseName: string,
  fn: (params: { page: Page; context: BrowserContext; locale: Locale }) => Promise<void>,
): void {
  for (const locale of LOCALES) {
    test(`${baseName} @${locale}`, async ({ page, context }) => {
      const baseUrl = new URL(page.url() || 'http://localhost:3000')
      await context.addCookies([
        {
          name: 'NEXT_LOCALE',
          value: locale,
          domain: baseUrl.hostname,
          path: '/',
        },
      ])
      await fn({ page, context, locale })
    })
  }
}

export { LOCALES, type Locale }
