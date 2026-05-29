import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "../../src/db/pool.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

export const maxDuration = 60;

/**
 * DEVELOPMENT UTILITY — wipe every flight entry and its audit trail across all
 * pilots. Intended for the pre-launch testing phase only; remove this file
 * before the system carries any real regulatory data.
 *
 * Truncates flight_entries, flight_entry_versions, signatures,
 * signoff_request_entries, signoff_requests, entry_imports, and audit_ledger
 * with RESTART IDENTITY CASCADE. The forbid_mutation triggers only fire on
 * UPDATE/DELETE, not on TRUNCATE, so the operation completes without disabling
 * the append-only guarantees that govern normal runtime writes.
 *
 * Preserved: pilots/users, roles, import_tokens (the credentials themselves,
 * which the pilot still needs), aircraft/airports reference data.
 *
 * Authorised by either an ADMIN session or the ADMIN_BOOTSTRAP_TOKEN, and
 * additionally requires a literal confirmation phrase in the body so a stray
 * curl can't trigger it.
 */
const CONFIRM_PHRASE = "WIPE_ALL_LOGS";

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

    const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
    if ((body as { confirm?: string })?.confirm !== CONFIRM_PHRASE) {
      res.status(400).json({ error: `Set body.confirm to "${CONFIRM_PHRASE}" to proceed.` });
      return;
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await tally(client);
      await client.query(`
        TRUNCATE
          signoff_request_entries,
          signoff_requests,
          signatures,
          entry_imports,
          flight_entry_versions,
          audit_ledger,
          flight_entries
          RESTART IDENTITY CASCADE
      `);
      await client.query("COMMIT");
      res.status(200).json({ wiped: true, before });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Wipe failed." });
  }
}

async function tally(client: { query: (q: string) => Promise<{ rows: Array<{ n: string }> }> }) {
  const tables = [
    "flight_entries",
    "flight_entry_versions",
    "signatures",
    "signoff_requests",
    "entry_imports",
    "audit_ledger",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await client.query(`SELECT count(*)::text AS n FROM ${t}`);
    counts[t] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
