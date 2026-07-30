import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% — emissão fiscal é crítica (regra 47): nota autorizada e errada
 * vira passivo fiscal do cliente e é irreversível pelo LogiFit. Piso alto,
 * igual a `errors`/`security`/`db`, e não os 60% de `@repo/ai`.
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
