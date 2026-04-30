import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config (ADR 0090). Suítes em e2e/{smoke,critical,regression,...}
 * com gates por suíte definidos no ci.yml.
 *
 * Matriz: viewports {390, 768, 1280} × locales {pt-BR, en-US, es-419} ×
 * browsers {chromium, webkit}. Padrão por teste = 1×1×1; markers `@responsive`
 * e `@i18n` expandem.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
    },
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], browserName: 'webkit' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
