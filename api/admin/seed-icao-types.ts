import type { VercelRequest, VercelResponse } from "@vercel/node";
import { seedIcaoTypes } from "../../src/db/seedIcaoTypes.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

// Seeding ~2600 rows is quick, but allow headroom over a normal request.
export const maxDuration = 60;

/**
 * Load the bundled ICAO Doc 8643 type designator list into the reference table,
 * so a registration lookup can classify an aircraft's category and engines.
 * Idempotent (upsert), so it can be re-run to refresh. Authorised either by an
 * admin session or by the bootstrap token, so it can also be triggered from a
 * browser URL: /api/admin/seed-icao-types?token=YOUR_ADMIN_BOOTSTRAP_TOKEN.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const bootstrap = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const presented =
      (typeof req.query.token === "string" ? req.query.token : undefined) ??
      (typeof req.headers["x-admin-token"] === "string" ? (req.headers["x-admin-token"] as string) : undefined);

    let authorised = Boolean(bootstrap && presented && presented === bootstrap);
    if (!authorised) {
      const claims = await requireUser(req); // throws AuthError if no/invalid session
      authorised = claims.roles.includes("ADMIN");
    }
    if (!authorised) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }

    const seeded = await seedIcaoTypes();
    res.status(200).json({ seeded });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Seeding failed." });
  }
}
