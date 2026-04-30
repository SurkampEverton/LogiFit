/**
 * RLS check — falha se houver tabela com `tenant_id` sem RLS habilitada (regra 1+2).
 * Sprint 00: esqueleto. Quando o primeiro schema com tenant_id chegar (Sprint 01a),
 * a verificação fica funcional sem alteração.
 */
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  try {
    const result = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND a.attname = 'tenant_id'
        AND a.attnum > 0
        AND NOT c.relrowsecurity
      ORDER BY c.relname;
    `)

    if (result.rows.length === 0) {
      console.log('✓ rls-check: nenhuma tabela com tenant_id sem RLS')
      return
    }

    console.error('✗ rls-check FALHA: tabelas com tenant_id sem RLS habilitada (regra 1+2):')
    for (const row of result.rows) {
      console.error(`  - public.${row.table_name}`)
    }
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('rls-check error:', err)
  process.exit(1)
})
