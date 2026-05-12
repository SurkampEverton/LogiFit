/**
 * Migration runner — aplica scripts em TRÊS fases:
 *   1. init/*.sql           — SQL idempotente (extensões PostgreSQL, tipos custom)
 *   2. migrations/*.sql     — geradas por `drizzle-kit generate` (tabelas + tipos enum)
 *   3. src/policies/*.sql   — RLS policies + triggers de check (escrito à mão,
 *                              não-gerado; Drizzle não suporta policies nativamente)
 *
 * Convenção:
 *   - Fase 1 e 3 são **idempotentes**: usam `IF NOT EXISTS` / `CREATE OR REPLACE`
 *   - Fase 2 NÃO é idempotente: drizzle-kit gerencia journal em
 *     `migrations/meta/_journal.json` — rodar 2× não duplica.
 *   - Fase 3 roda SEMPRE (idempotência via DROP+CREATE de policies/triggers).
 *
 * Policies precisam de DROP IF EXISTS antes de CREATE pra serem idempotentes
 * (CREATE POLICY não tem `OR REPLACE`). Wrapper aplica em transação.
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INIT_DIR = resolve(ROOT, 'init')
const MIGRATIONS_DIR = resolve(ROOT, 'migrations')
const POLICIES_DIR = resolve(ROOT, 'src', 'policies')

function maskUrl(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

async function applyInitScripts(pool: Pool): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(INIT_DIR)).filter((f) => f.endsWith('.sql')).sort()
  } catch {
    return
  }
  for (const file of files) {
    const sql = await readFile(resolve(INIT_DIR, file), 'utf8')
    console.log(`• init: ${file}`)
    await pool.query(sql)
  }
}

async function applyDrizzleMigrations(pool: Pool): Promise<void> {
  try {
    await stat(resolve(MIGRATIONS_DIR, 'meta', '_journal.json'))
  } catch {
    console.log('⊘ no Drizzle migrations yet')
    return
  }
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  console.log('✓ Drizzle migrations applied')
}

/**
 * Aplica policies SQL — idempotente.
 *
 * Convenção (escrita à mão nos arquivos `src/policies/*.sql`):
 *   - POLICY: heurística extrai nomes de `CREATE POLICY` e gera `DROP IF EXISTS` antes
 *   - TRIGGER: cada arquivo escreve `DROP TRIGGER IF EXISTS ... ON ...;` explicitamente
 *     antes do CREATE TRIGGER (regex multi-linha era frágil — explícito é mais claro)
 *   - FUNCTION: usa `CREATE OR REPLACE FUNCTION` (Postgres aceita nativamente)
 *
 * Cada arquivo roda em transação isolada — falha não corrompe estado parcial.
 */
async function applyPolicies(pool: Pool): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(POLICIES_DIR)).filter((f) => f.endsWith('.sql')).sort()
  } catch {
    return
  }
  for (const file of files) {
    const fullSql = await readFile(resolve(POLICIES_DIR, file), 'utf8')
    const policyDrops = extractPolicyDrops(fullSql)
    console.log(`• policy: ${file} (${policyDrops.length} policy drops + triggers/functions inline)`)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const drop of policyDrops) {
        try {
          await client.query(drop)
        } catch {
          /* drop-then-create tolerates missing object */
        }
      }
      await client.query(fullSql)
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}

function extractPolicyDrops(sql: string): string[] {
  const drops: string[] = []
  const policyRe = /CREATE\s+POLICY\s+(\w+)\s+ON\s+(\w+)/gi
  for (const m of sql.matchAll(policyRe)) {
    drops.push(`DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};`)
  }
  return drops
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  console.log(`→ migrating ${maskUrl(DATABASE_URL)}`)
  try {
    await applyInitScripts(pool)
    await applyDrizzleMigrations(pool)
    await applyPolicies(pool)
    console.log('✓ done')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
