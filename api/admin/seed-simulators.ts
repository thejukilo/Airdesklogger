import type { VercelRequest, VercelResponse } from "@vercel/node";
import { seedSimulators } from "../../src/db/seedSimulators.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

// Seeding ~900 rows is quick, but allow headroom over a normal request.
export const maxDuration = 60;

/**
 * Load the bundled certified-simulator list into the reference table, so a pilot
 * can pick a device by autocomplete when logging a simulator session. Idempotent
 * (replaces the table). Authorised by an admin session or the bootstrap token,
 * so it can be triggered from a browser URL:
 *   /api/admin/seed-simulators?token=YOUR_ADMIN_BOOTSTRAP_TOKEN.
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

    const seeded = await seedSimulators();
    res.status(200).json({ seeded });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Seeding failed." });
  }
}
