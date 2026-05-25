/** Apply schema.sql. Idempotent (uses IF NOT EXISTS / OR REPLACE throughout). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closePool, withTransaction } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK = 947_213_777; // serialises concurrent migrations

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  // A transaction-scoped advisory lock makes concurrent migrations (parallel
  // tests, or two deploys racing) safe, and PostgreSQL DDL is transactional so
  // the whole schema is applied atomically.
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(sql);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  migrate()
    .then(() => {
      console.log("Migration complete.");
      return closePool();
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
