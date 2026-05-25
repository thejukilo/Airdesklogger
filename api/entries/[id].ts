import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RequestError } from "../../src/http/parseEntry.js";
import { prepareFlightEntry } from "../../src/http/buildEntry.js";
import {
  amendEntry,
  voidEntry,
  getCurrentVersion,
  getEntryMeta,
  getHistory,
  getEntrySignatures,
} from "../../src/db/repository.js";
import { canEditOwnLogbook } from "../../src/auth/roles.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

const SIGNER_ROLES = ["INSTRUCTOR", "EXAMINER", "ATO", "DTO", "HOT", "AIRPORT"];

/**
 * A single entry.
 *   GET    returns the current version, its change history and its sign-offs.
 *   PATCH  records a correction as a new immutable version. Only the holder may
 *          amend, and only while the entry is unlocked.
 *   DELETE voids the entry (removes it from the logbook while keeping the record
 *          for the audit trail). Only the holder, and only while unlocked.
 * A locked (signed) entry can neither be amended nor deleted.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const entryId = String(req.query.id);
  try {
    const claims = await requireUser(req);
    const meta = await getEntryMeta(entryId);
    if (!meta || meta.voided) {
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
      const raw = typeof req.body === "string" ? safeJson(req.body) : req.body;
      const reason = typeof (raw as { reason?: unknown })?.reason === "string" && (raw as { reason: string }).reason.trim()
        ? (raw as { reason: string }).reason
        : "correction";
      const prepared = await prepareFlightEntry(raw, claims.sub, { excludeEntryId: entryId });
      if (!prepared.ok) {
        res.status(prepared.status).json(prepared.body);
        return;
      }
      const amended = await amendEntry(entryId, prepared.input, prepared.derived, claims.sub, reason);
      res.status(200).json(amended);
      return;
    }

    if (req.method === "DELETE") {
      if (!isOwner) {
        res.status(403).json({ error: "Only the holder may delete their entries." });
        return;
      }
      if (meta.locked) {
        res.status(409).json({ error: "Entry is locked by sign-off and cannot be deleted." });
        return;
      }
      await voidEntry(entryId, claims.sub);
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(405).json({ error: "Use GET, PATCH or DELETE." });
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

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
