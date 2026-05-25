import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "../src/db/pool.js";

/**
 * Liveness and readiness check. Reports the service is up, whether the required
 * environment is present (as booleans, never the values), and with ?db=1 whether
 * the database connection works. It does not return internal error detail, which
 * stays in the server log.
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
    } catch {
      out.db = "error";
    }
  }

  res.status(200).json(out);
}
