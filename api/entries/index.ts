import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RequestError } from "../../src/http/parseEntry.js";
import { prepareFlightEntry } from "../../src/http/buildEntry.js";
import { createEntry, listEntriesForPilot } from "../../src/db/repository.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/**
 * The logbook collection for the signed-in holder.
 *   GET  lists the holder's own entries.
 *   POST records a new entry. The holder id always comes from the session, never
 *        the request body, so a pilot can only write to their own logbook.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);

    if (req.method === "GET") {
      res.status(200).json({ entries: await listEntriesForPilot(claims.sub) });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeJson(req.body) : req.body;
      const prepared = await prepareFlightEntry(raw, claims.sub);
      if (!prepared.ok) {
        res.status(prepared.status).json(prepared.body);
        return;
      }
      const created = await createEntry(prepared.input, prepared.derived, claims.sub);
      res.status(201).json(created);
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
