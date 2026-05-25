import type { VercelRequest, VercelResponse } from "@vercel/node";
import { signSession } from "../../src/auth/tokens.js";
import { getJwtSecret } from "../../src/config.js";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { addRole, databaseStats, getUserById } from "../../src/db/authRepository.js";
import { fromAircraftCsv, upsertAircraftBatch } from "../../src/db/seedAircraft.js";

// Importing a dataset can take longer than a normal request.
export const maxDuration = 300;

/**
 * Admin actions behind one function, dispatched by the path segment:
 *   POST /api/admin/bootstrap       grant ADMIN to the caller (bootstrap token)
 *   GET  /api/admin/stats           database size and row counts
 *   POST /api/admin/import-aircraft load the configured aircraft dataset
 * The airport import keeps its own endpoint (/api/admin/import-airports).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);
    const action = String(req.query.action);

    if (action === "bootstrap") {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Use POST." });
        return;
      }
      const body = parseBody(req);
      const token = process.env.ADMIN_BOOTSTRAP_TOKEN;
      if (!token || (body as { token?: string })?.token !== token) {
        res.status(403).json({ error: "Invalid bootstrap token." });
        return;
      }
      await addRole(claims.sub, "ADMIN");
      const user = await getUserById(claims.sub);
      if (!user) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      // Reissue the session so the new role takes effect without a re-login.
      const newToken = await signSession({ sub: user.id, roles: user.roles, email: user.email ?? "" }, getJwtSecret());
      res.status(200).json({ token: newToken, user: { id: user.id, email: user.email, name: user.name, roles: user.roles } });
      return;
    }

    // All other actions require the caller to actually be an administrator.
    const me = await getUserById(claims.sub);
    if (!me || !me.roles.includes("ADMIN")) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }

    if (action === "stats") {
      if (req.method !== "GET") {
        res.status(405).json({ error: "Use GET." });
        return;
      }
      res.status(200).json(await databaseStats());
      return;
    }

    if (action === "import-aircraft") {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Use POST." });
        return;
      }
      const url = process.env.AIRCRAFT_CSV_URL;
      if (!url) {
        res.status(200).json({
          imported: 0,
          configured: false,
          message:
            "No aircraft dataset is configured. Aircraft are added automatically when a registration is looked up; set AIRCRAFT_CSV_URL to bulk-import a fleet.",
        });
        return;
      }
      const csv = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!csv.ok) {
        res.status(502).json({ error: `Could not fetch the aircraft dataset (${csv.status}).` });
        return;
      }
      const records = fromAircraftCsv(await csv.text());
      const imported = await upsertAircraftBatch(records);
      res.status(200).json({ imported, configured: true, source: url });
      return;
    }

    res.status(404).json({ error: "Unknown admin action." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Admin action failed." });
  }
}

function parseBody(req: VercelRequest): unknown {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
