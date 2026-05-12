import baseConfig from '@repo/config/vitest.base'
import { defineConfig, mergeConfig } from 'vitest/config'

/**
 * Coverage 80% — `packages/db` é fonte única de schema (regra 3 + ADR 0004)
 * + RLS policies (regra 1+2). Mesmo piso de `packages/security|errors|storage`
 * (regra 18 + ADR 0090).
 *
 * Sprint 01a Faixa A: cobertura inicial só do validador CPF/CNPJ. Demais
 * módulos (schema, policies) entram conforme features aterrissam.
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
        // Schema-only dirs (sem lógica) ficam fora do gate de coverage
        exclude: [
          'scripts/**',
          'src/index.ts',
          'src/schema/**',
          'src/policies/**',
          'src/client.ts',
          'tests/rls-runtime.test.ts', // integration test (precisa Postgres+seed local)
          'tests/trial-lifecycle.test.ts', // integration test trial lifecycle (Faixa G)
          'tests/passport.test.ts', // integration test passaporte cross-tenant (Sprint 01b)
        ],
      },
    },
  }),
)
