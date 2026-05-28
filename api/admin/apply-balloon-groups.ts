import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyBalloonGroupsFromCsv } from "../../src/db/seedAircraft.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

export const maxDuration = 60;

/**
 * One-off backfill: set the balloon_group column on existing balloon aircraft
 * from a posted CSV (registration,balloon_group pairs; extra columns ignored).
 * Authorised by an admin session or the bootstrap token, so it can be invoked
 * from curl with --data-binary @balloons.csv.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Use POST." });
      return;
    }

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

    // Vercel may parse the body for us based on content-type; the CSV form
    // arrives as a string. Fall back to a JSON {csv: "..."} envelope.
    let csv: string | undefined;
    if (typeof req.body === "string") csv = req.body;
    else if (req.body && typeof (req.body as { csv?: string }).csv === "string") csv = (req.body as { csv: string }).csv;
    if (!csv) {
      res.status(400).json({ error: "POST a CSV body (registration,balloon_group)." });
      return;
    }

    const updated = await applyBalloonGroupsFromCsv(csv);
    res.status(200).json({ updated });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Apply failed." });
  }
}
