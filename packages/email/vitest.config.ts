import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% — `@repo/email` mexe com canal LGPD crítico (magic link auth +
 * email confirmation Sprint 02b + cobrança Sprint 04). Mesmo piso de
 * security/errors/storage/db (regra 18 + ADR 0090).
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        exclude: ['src/index.ts'],
      },
    },
  }),
)
