import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseEntryRequest, RequestError } from "../../src/http/parseEntry.js";
import { validateEntry } from "../../src/domain/validation.js";
import {
  amendEntry,
  getCurrentVersion,
  getEntryMeta,
  getHistory,
  getEntrySignatures,
} from "../../src/db/repository.js";
import { validateFlightReferences } from "../../src/http/validateReferences.js";
import { canEditOwnLogbook } from "../../src/auth/roles.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

const SIGNER_ROLES = ["INSTRUCTOR", "EXAMINER", "ATO", "DTO", "HOT", "AIRPORT"];

/**
 * A single entry.
 *   GET   returns the current version, its change history and its sign-offs. The
 *         holder and admins can always view; a signer role may also view so they
 *         can review an entry before countersigning it.
 *   PATCH records a correction as a new immutable version. Only the holder may
 *         amend, and only while the entry is unlocked; a locked (signed) entry
 *         returns 409.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const entryId = String(req.query.id);
  try {
    const claims = await requireUser(req);
    const meta = await getEntryMeta(entryId);
    if (!meta) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    const isOwner = canEditOwnLogbook(claims.sub, meta.pilotId);
    const isAdmin = claims.roles.includes("ADMIN");

    const isSigner = claims.roles.some((r) => SIGNER_ROLES.includes(r));

    if (req.method === "GET") {
      if (!isOwner && !isAdmin && !isSigner) {
        res.status(403).json({ error: "Not your logbook." });
        return;
      }
      res.status(200).json({
        current: await getCurrentVersion(entryId),
        history: await getHistory(entryId),
        signatures: await getEntrySignatures(entryId),
      });
      return;
    }

    if (req.method === "PATCH") {
      if (!isOwner) {
        res.status(403).json({ error: "Only the holder may amend their logbook." });
        return;
      }
      if (meta.locked) {
        res.status(409).json({ error: "Entry is locked by sign-off and cannot be amended." });
        return;
      }
      const raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const reason = typeof raw?.reason === "string" && raw.reason.trim() ? raw.reason : "correction";
      const input = parseEntryRequest({ ...(raw as object), pilotId: claims.sub });
      const result = validateEntry(input);
      if (!result.valid || !result.derived) {
        res.status(422).json({ valid: false, issues: result.issues });
        return;
      }
      const refIssues = await validateFlightReferences(input);
      if (refIssues.length > 0) {
        res.status(422).json({ valid: false, issues: refIssues });
        return;
      }
      const amended = await amendEntry(entryId, input, result.derived, claims.sub, reason);
      res.status(200).json(amended);
      return;
    }

    res.status(405).json({ error: "Use GET or PATCH." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error("entry handler error:", err);
    res.status(500).json({ error: "Server error handling the entry." });
  }
}
