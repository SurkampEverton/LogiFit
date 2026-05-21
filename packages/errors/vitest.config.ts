import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% pra módulos puros (api-error/capture/fingerprint/sanitize) +
 * 60% baseline pro pacote inteiro — wrappers (wrap-action/api-handler/job),
 * logger (pino → stdout) e translators são integration-heavy: cobertura real
 * vem de Sprint 01a+ via E2E que disparam erros reais de cada provider.
 *
 * Decisão: gate global em 60% (alinha com Server Actions Sprint 01a piso) e
 * include só os módulos puros — preserva enforcement onde dá pra cobrir com
 * unit test puro. Sprint dono eleva pra 80% quando tests integration de
 * wrappers entrarem.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
        exclude: [
          'src/index.ts',
          // Integration-heavy — Sprint 01a+ cobre via E2E
          'src/wrap-action.ts',
          'src/wrap-api-handler.ts',
          'src/wrap-job.ts',
          'src/translators.ts',
          'src/logger.ts',
        ],
      },
    },
  }),
)
