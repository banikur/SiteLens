import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

let pool: Pool | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    dbInstance = drizzle(pool, { schema });
  }
  return dbInstance;
}

export async function checkDbHealth(): Promise<'connected' | 'unconfigured' | 'error'> {
  const db = getDb();
  if (!db || !pool) {
    return 'unconfigured';
  }
  try {
    await pool.query('SELECT 1');
    return 'connected';
  } catch (err) {
    console.error('Database healthcheck failed:', err);
    return 'error';
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    dbInstance = null;
  }
}

