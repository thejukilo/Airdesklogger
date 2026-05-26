import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RequestError } from "../../src/http/parseEntry.js";
import { prepareFlightEntry, summarizeChanges } from "../../src/http/buildEntry.js";
import {
  amendEntry,
  voidEntry,
  getCurrentVersion,
  getEntryEditContext,
  getEntrySignerContacts,
  getHistory,
  getEntrySignatures,
  createSignoffRequest,
} from "../../src/db/repository.js";
import type { SignerRole } from "../../src/domain/signature.js";
import { canEditOwnLogbook } from "../../src/auth/roles.js";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { sendEntryReopenedEmail } from "../../src/http/email.js";

const SIGNER_ROLES = ["INSTRUCTOR", "EXAMINER", "ATO", "DTO", "HOT", "AIRPORT"];
const GRACE_MS = 48 * 60 * 60 * 1000; // 48 hours from the initial entry (FOCA 2.3.7)

/**
 * A single entry.
 *   GET    returns the current version, change history and sign-offs.
 *   PATCH  edits the entry. Within 48 hours of the initial entry the change is
 *          silent (not in the export change log); after that the flight time may
 *          not be increased and the change is logged. Editing a signed entry
 *          removes the sign-off and reopens it, telling the signer.
 *   DELETE voids the entry. Within 48 hours it is silent; after that the deletion
 *          is logged and shown on the FOCA export.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const entryId = String(req.query.id);
  try {
    const claims = await requireUser(req);
    const ctx = await getEntryEditContext(entryId);
    if (!ctx || ctx.voided) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    const isOwner = canEditOwnLogbook(claims.sub, ctx.pilotId);
    const isAdmin = claims.roles.includes("ADMIN");
    const isSigner = claims.roles.some((r) => SIGNER_ROLES.includes(r));
    const within48h = Date.now() < new Date(ctx.createdAt).getTime() + GRACE_MS;

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
      const raw = typeof req.body === "string" ? safeJson(req.body) : req.body;
      const prepared = await prepareFlightEntry(raw, claims.sub, { excludeEntryId: entryId });
      if (!prepared.ok) {
        res.status(prepared.status).json(prepared.body);
        return;
      }
      // After the grace window the flight time may only be reduced (FOCA 2.3.5).
      if (!within48h && prepared.derived.total > ctx.total) {
        res.status(422).json({
          valid: false,
          issues: [{ field: "total", message: "After 48 hours the flight time may not be increased. You may only reduce it." }],
        });
        return;
      }
      const logged = !within48h;
      const reasonRaw = (raw as { reason?: unknown })?.reason;
      const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim() : "correction";

      const wasSigned = ctx.locked;
      // Capture the previous content (for the change summary) and the signers
      // before the amendment reopens the entry.
      const before = wasSigned ? await getCurrentVersion(entryId) : null;
      const contacts = wasSigned ? await getEntrySignerContacts(entryId) : [];

      const amended = await amendEntry(entryId, prepared.input, prepared.derived, claims.sub, reason, logged);

      if (wasSigned && contacts.length > 0) {
        const holder = claims.email || "the pilot";
        const origin = process.env.APP_BASE_URL ?? `https://${req.headers.host}`;
        const first = prepared.input.legs[0]!;
        const last = prepared.input.legs[prepared.input.legs.length - 1]!;
        const flight = {
          date: prepared.derived.date,
          route: `${first.departurePlace} to ${last.arrivalPlace}`,
          aircraft: `${prepared.input.aircraft.makeModelVariant} (${prepared.input.aircraft.registration})`,
        };
        const oldContent = (before?.content ?? null) as { columns?: Record<string, unknown>; picName?: string } | null;
        const changes = summarizeChanges(oldContent, oldContent?.picName ?? "", prepared.derived, prepared.input.picName);
        // Each former signer gets a fresh single-use signing link, plus the diff.
        await Promise.all(
          contacts.map(async (c) => {
            try {
              const { token } = await createSignoffRequest({
                entryId,
                signerName: c.name,
                signerEmail: c.email,
                capacity: c.role as SignerRole,
                createdBy: claims.sub,
              });
              await sendEntryReopenedEmail({
                to: c.email,
                signerName: c.name,
                holderName: holder,
                flight,
                link: `${origin}/sign/${token}`,
                changes,
              });
            } catch {
              // Notifying the signer is best-effort; the edit itself succeeded.
            }
          }),
        );
      }

      res.status(200).json({ ...amended, reopened: wasSigned });
      return;
    }

    if (req.method === "DELETE") {
      if (!isOwner) {
        res.status(403).json({ error: "Only the holder may delete their entries." });
        return;
      }
      await voidEntry(entryId, claims.sub, !within48h);
      res.status(200).json({ deleted: true, logged: !within48h });
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
