import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fromOurAirportsCsv, upsertAirports } from "../../src/db/seedAirports.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

// Loading the whole register takes longer than a normal request; allow up to
// five minutes (Pro plan).
export const maxDuration = 300;

const DEFAULT_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv";

/**
 * One-time import of the full public airport register (OurAirports) into the
 * reference table, so every ICAO code is selectable as FOCA 2.3.3 expects.
 * Runs on the deployment, which has outbound internet. Authorised either by an
 * admin session or by the bootstrap token (so it can be triggered from a browser
 * URL): /api/admin/import-airports?token=YOUR_ADMIN_BOOTSTRAP_TOKEN.
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

    const url = process.env.AIRPORTS_CSV_URL ?? DEFAULT_CSV;
    const csvRes = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!csvRes.ok) {
      res.status(502).json({ error: `Could not fetch the airport dataset (${csvRes.status}).` });
      return;
    }
    const airports = fromOurAirportsCsv(await csvRes.text());
    const imported = await upsertAirports(airports);
    res.status(200).json({ imported, source: url });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed." });
  }
}
