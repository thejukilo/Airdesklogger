/**
 * PostgreSQL connection pool.
 *
 * Serverless-friendly for Vercel: the pool is tiny by default (each warm lambda
 * keeps its own), and connection details come from DATABASE_URL when set, falling
 * back to standard PG* environment variables (used by local development/tests).
 * Point DATABASE_URL at a POOLED endpoint (Vercel Postgres / Neon pooler /
 * Supabase pgbouncer) in production to avoid exhausting direct connections.
 */

import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const max = Number(process.env.PGPOOL_MAX ?? "1") || 1;
    pool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL, max })
      : new Pool({ max }); // falls back to PGHOST/PGUSER/PGDATABASE/...
  }
  return pool;
}

/** Run a function inside a transaction, committing on success. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
