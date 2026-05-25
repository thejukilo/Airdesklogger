import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "../src/db/pool.js";

/**
 * Liveness and configuration check. Reports whether the runtime has the
 * environment it needs (as booleans, never the values), and with ?db=1 it
 * attempts a single query so a misconfigured database connection can be
 * diagnosed without reading the platform logs.
 */
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
    try {
      await getPool().query("SELECT 1");
      out.db = "ok";
    } catch (err) {
      out.db = "error";
      // The pg error message names the failure (bad password, host not found,
      // wrong pooler user) but never contains the password.
      out.dbError = err instanceof Error ? err.message : String(err);
    }
  }

  res.status(200).json(out);
}
