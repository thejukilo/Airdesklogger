import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { createSignoffRequest, getEntryMeta, getCurrentVersion } from "../../../src/db/repository.js";
import { getUserById } from "../../../src/db/authRepository.js";
import { sendSignoffEmail, emailConfigured } from "../../../src/http/email.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

function hhmm(v: unknown): string {
  const m = Number(v ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "00:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The holder asks an external instructor or examiner (someone without an
 * account) to countersign one or more of their entries. One signing link covers
 * the whole batch, so the signer countersigns everything at once.
 *
 * POST /api/entries/{id}/request-signoff      one entry (the path id)
 * POST /api/entries/batch/request-signoff     bulk (entryIds in the body)
 */
const Body = z.object({
  signerName: z.string().min(1),
  signerEmail: z.string().email(),
  capacity: z.enum(["INSTRUCTOR", "EXAMINER", "SUPERVISING_PIC", "ATO", "DTO", "HOT", "AIRPORT", "OTHER"]),
  entryIds: z.array(z.string().uuid()).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const idParam = String(req.query.id);
  const batch = idParam === "batch";
  try {
    const claims = await requireUser(req);

    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    const entryIds = batch ? parsed.data.entryIds ?? [] : [idParam];
    if (entryIds.length === 0) {
      res.status(400).json({ error: "At least one entry is required." });
      return;
    }
    // Every entry must exist, belong to the holder, and be unlocked.
    for (const id of entryIds) {
      const meta = await getEntryMeta(id);
      if (!meta) {
        res.status(404).json({ error: "Entry not found." });
        return;
      }
      if (meta.pilotId !== claims.sub && !claims.roles.includes("ADMIN")) {
        res.status(403).json({ error: "Only the holder may request a sign-off." });
        return;
      }
      if (meta.locked) {
        res.status(409).json({ error: "One of the selected entries is already locked." });
        return;
      }
    }

    const { token, expiresAt } = await createSignoffRequest({
      entryIds,
      signerName: parsed.data.signerName,
      signerEmail: parsed.data.signerEmail,
      capacity: parsed.data.capacity,
      createdBy: claims.sub,
    });

    const origin = process.env.APP_BASE_URL ?? `https://${req.headers.host}`;
    const link = `${origin}/sign/${token}`;

    // Gather context so the email reads as a genuine, useful request. For a
    // bulk request we point at the first entry and note how many follow.
    const holder = await getUserById(claims.sub);
    const firstId = entryIds[0]!;
    const version = await getCurrentVersion(firstId);
    const cols = (version?.content?.columns ?? {}) as Record<string, unknown>;
    const ac = (version?.content?.aircraft ?? {}) as { makeModelVariant?: string; registration?: string };
    const more = entryIds.length > 1 ? ` (+${entryIds.length - 1} more)` : "";

    const emailed = await sendSignoffEmail({
      to: parsed.data.signerEmail,
      link,
      holderName: holder?.name || "A pilot",
      signerName: parsed.data.signerName,
      capacity: parsed.data.capacity,
      flight: {
        date: String(cols.date ?? ""),
        route: `${cols.departurePlace ?? ""} to ${cols.arrivalPlace ?? ""}${more}`,
        aircraft: `${ac.makeModelVariant ?? ""} (${ac.registration ?? ""})`,
        total: hhmm(cols.total),
      },
      ...(claims.email ? { replyTo: claims.email } : {}),
    });

    res.status(201).json({ link, expiresAt, emailed, emailConfigured: emailConfigured(), entryCount: entryIds.length });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
