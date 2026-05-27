import type { VercelRequest, VercelResponse } from "@vercel/node";
import { seedAircraft } from "../../src/db/seedAircraft.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

// Importing ~3000 rows is quick, but allow headroom over a normal request.
export const maxDuration = 60;

/**
 * Load the bundled national aircraft register into the reference table, taking
 * each specific type's model and engine count from icao_types (so seed the ICAO
 * types first). Idempotent (upsert by registration). Authorised by an admin
 * session or the bootstrap token, so it can be triggered from a browser URL:
 *   /api/admin/seed-aircraft?token=YOUR_ADMIN_BOOTSTRAP_TOKEN.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const bootstrap = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const presented =
      (typeof req.query.token === "string" ? req.query.token : undefined) ??
      (typeof req.headers["x-admin-token"] === "string" ? (req.headers["x-admin-token"] as string) : undefined);

    let authorised = Boolean(bootstrap && presented && presented === bootstrap);
    if (!authorised) {
      const claims = await requireUser(req);
      authorised = claims.roles.includes("ADMIN");
    }
    if (!authorised) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }

    const seeded = await seedAircraft();
    res.status(200).json({ seeded });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Seeding failed." });
  }
}
