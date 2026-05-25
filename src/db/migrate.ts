/** Apply schema.sql. Idempotent (uses IF NOT EXISTS / OR REPLACE throughout). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, closePool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(): Promise<void> {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  await getPool().query(sql);
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
