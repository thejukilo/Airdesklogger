import type { VercelRequest, VercelResponse } from "@vercel/node";
import { seedAircraftEurope } from "../../src/db/seedAircraft.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

// ~71k rows; allow well over a normal request.
export const maxDuration = 300;

/**
 * Load the bundled Europe-wide aircraft register, skipping any registration that
 * is already present (so an earlier national import like the Swiss one is kept).
 * Each specific type's model and engine count come from icao_types, so seed the
 * ICAO types first. Authorised by an admin session or the bootstrap token, so it
 * can be triggered from a browser URL:
 *   /api/admin/seed-aircraft-europe?token=YOUR_ADMIN_BOOTSTRAP_TOKEN.
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

    const seeded = await seedAircraftEurope();
    res.status(200).json({ seeded });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Seeding failed." });
  }
}
