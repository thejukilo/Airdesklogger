import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "../src/db/pool.js";
import { hashPassword } from "../src/auth/passwords.js";

/**
 * Liveness and configuration check. Reports whether the runtime has the
 * environment it needs (as booleans, never the values). With ?db=1 it also
 * checks the database the way sign-up does: that the connection works, that the
 * required tables and the pilots columns exist (so a partial schema load is
 * visible), and that the password hasher runs. This is a setup aid and can be
 * tightened or removed once the deployment is settled.
 */
const REQUIRED_TABLES = [
  "pilots",
  "flight_entries",
  "flight_entry_versions",
  "signatures",
  "audit_ledger",
  "account_events",
  "airports",
  "aircraft",
  "fstd_devices",
];

const REQUIRED_PILOT_COLUMNS = [
  "email",
  "password_hash",
  "roles",
  "first_name",
  "last_name",
  "date_of_birth",
  "address",
  "email_verification_token",
  "mfa_secret_wrapped",
  "mfa_enabled",
  "signing_public_key",
  "signing_key_wrapped",
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const out: Record<string, unknown> = {
    status: "ok",
    service: "airdesklogger",
    time: new Date().toISOString(),
    config: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      AUTH_JWT_SECRET: (process.env.AUTH_JWT_SECRET?.length ?? 0) >= 32,
      AUTH_SIGNING_MASTER_KEY: /^[0-9a-fA-F]{64}$/.test(process.env.AUTH_SIGNING_MASTER_KEY ?? ""),
    },
  };

  if (req.query.db === "1") {
    const pool = getPool();

    try {
      await pool.query("SELECT 1");
      out.db = "ok";
    } catch (err) {
      out.db = "error";
      out.dbError = err instanceof Error ? err.message : String(err);
    }

    if (out.db === "ok") {
      try {
        const { rows } = await pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
          [REQUIRED_TABLES],
        );
        const present = new Set(rows.map((r) => r.table_name as string));
        out.missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));

        const { rows: cols } = await pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'pilots'",
        );
        const have = new Set(cols.map((r) => r.column_name as string));
        out.pilotsMissingColumns = REQUIRED_PILOT_COLUMNS.filter((c) => !have.has(c));
      } catch (err) {
        out.schemaError = err instanceof Error ? err.message : String(err);
      }
    }

    try {
      await hashPassword("diagnostic-password-123");
      out.passwordHasher = "ok";
    } catch (err) {
      out.passwordHasher = "error";
      out.passwordHasherError = err instanceof Error ? err.message : String(err);
    }
  }

  res.status(200).json(out);
}
