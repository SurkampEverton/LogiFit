import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Cobertura alta: `@repo/types` é só schema e função pura, sem integração
 * externa — não há motivo pra deixar caminho sem teste.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  }),
)
