/**
 * Migration runner — aplica scripts em duas fases:
 *   1. init/*.sql        — SQL idempotente (extensões, tipos custom, etc.)
 *   2. migrations/*.sql  — geradas por `drizzle-kit generate` a partir do schema TS
 *
 * Sprint 00 só tem fase 1 (extensões). Schemas reais aparecem no Sprint 01a.
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
    console.log('⊘ no Drizzle migrations yet (schemas chegam no Sprint 01a)')
    return
  }
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  console.log('✓ Drizzle migrations applied')
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  console.log(`→ migrating ${maskUrl(DATABASE_URL)}`)
  try {
    await applyInitScripts(pool)
    await applyDrizzleMigrations(pool)
    console.log('✓ done')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
