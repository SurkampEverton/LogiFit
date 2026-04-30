import { defineConfig } from 'vitest/config'

/**
 * Config base de testes para o monorepo. Cada package extends via:
 *
 *   import { defineConfig, mergeConfig } from 'vitest/config'
 *   import baseConfig from '@repo/config/vitest.base'
 *   export default mergeConfig(baseConfig, defineConfig({ ... }))
 *
 * Coverage thresholds default seguem o piso de Server Actions (regra 18 + ADR 0090).
 * Packages mais críticos (errors, security, db/policies → 80%; db → 70%) sobrescrevem
 * via mergeConfig nos arquivos próprios.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/dist/**', '**/.next/**', '**/node_modules/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
})
