import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 60% baseline — `@repo/ai` é grande (genui, exames, nutri-agent,
 * fiscal, classifier, devices, registry, quotas, personas, redact, etc) e
 * boa parte é integração com Vercel AI SDK que precisa cred reais pra rodar.
 *
 * Sprint dono por sub-pacote eleva pra 80% conforme features clínicas
 * críticas estabilizam (exames + nutri-agent prioridade — regra 28 SaMD).
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
        exclude: ['src/index.ts'],
      },
    },
  }),
)
