import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copie .env.example para .env.local e preencha')
}

declare global {
  var __dbPool: Pool | undefined
}

const pool = globalThis.__dbPool ?? new Pool({ connectionString: DATABASE_URL })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__dbPool = pool
}

export { pool }
export const db = drizzle(pool)
