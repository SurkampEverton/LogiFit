import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% — `@repo/errors` é camada base de tratamento de erros
 * (ADR 0071 + regra 33). Wrappers protegem TODA Server Action / API Route /
 * Job; falha aqui se propaga pra tenant inteiro. Mesmo piso de security/db/storage.
 *
 * Faixa A do Sprint 01a populou translators reais. Cobertura inicial cresce
 * conforme cada provider integra.
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
