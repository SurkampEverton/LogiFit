import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% — `packages/storage` é camada de infra de defesa (ADR 0073),
 * mesmo piso de `packages/security|errors|db/policies` (regra 18 + ADR 0090).
 *
 * Testes de integração contra MinIO local: pulam silenciosamente se o
 * endpoint não estiver acessível (ver `minio-adapter.test.ts`). CI Faixa 2
 * sobe MinIO antes de rodar Vitest.
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
        exclude: ['scripts/**', 'src/index.ts'],
      },
    },
  }),
)
