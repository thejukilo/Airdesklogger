import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  getSignoffRequestByToken,
  getCurrentVersion,
  signEntriesExternal,
} from "../../src/db/repository.js";

/**
 * Public, token-authenticated signing for an external signer (no account). One
 * link can cover several entries; the signer countersigns the batch with one
 * signature, recording the place they signed at.
 *
 *   GET  returns the capacity asked of them and a summary of every entry in the
 *        batch. The token is the authentication.
 *   POST signs and locks every entry in the batch. The signer's full name is
 *        required; a licence number and the place are optional. The token is
 *        single-use.
 */
const Body = z.object({
  signerName: z.string().trim().min(1, "Your full name is required."),
  signerLicense: z.string().optional(),
  signedPlace: z.string().trim().min(1, "Place of signing is required.").max(200),
  signatureImage: z.string().startsWith("data:image/", "A drawn signature is required.").max(300_000),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = String(req.query.token);

  if (req.method === "GET") {
    const request = await getSignoffRequestByToken(token);
    if (!request) {
      res.status(404).json({ error: "This signing link is invalid, already used, or expired." });
      return;
    }
    const entries = [];
    for (const entryId of request.entryIds) {
      const version = await getCurrentVersion(entryId);
      const cols = (version?.content?.columns ?? {}) as Record<string, unknown>;
      const aircraft = (version?.content?.aircraft ?? {}) as { makeModelVariant?: string; registration?: string };
      entries.push({
        id: entryId,
        date: cols.date ?? null,
        departurePlace: cols.departurePlace ?? null,
        arrivalPlace: cols.arrivalPlace ?? null,
        total: cols.total ?? null,
        picName: version?.content?.picName ?? null,
        aircraft: `${aircraft.makeModelVariant ?? ""} (${aircraft.registration ?? ""})`,
        locked: Boolean(version?.locked),
      });
    }
    res.status(200).json({
      capacity: request.capacity,
      signerName: request.signerName,
      entries,
    });
    return;
  }

  if (req.method === "POST") {
    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Full name, place and a drawn signature are all required." });
      return;
    }
    try {
      const { entryIds } = await signEntriesExternal(token, {
        signerName: parsed.data.signerName,
        ...(parsed.data.signerLicense ? { signerLicense: parsed.data.signerLicense } : {}),
        ...(parsed.data.signedPlace ? { signedPlace: parsed.data.signedPlace } : {}),
        ...(parsed.data.signatureImage ? { signatureImage: parsed.data.signatureImage } : {}),
      });
      res.status(200).json({ locked: true, entryIds });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "Could not sign." });
    }
    return;
  }

  res.status(405).json({ error: "Use GET or POST." });
}
