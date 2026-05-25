import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  getSignoffRequestByToken,
  getCurrentVersion,
  signEntryExternal,
} from "../../src/db/repository.js";

/**
 * Public, token-authenticated signing for an external signer (no account).
 *   GET  returns what the signer needs to see: the capacity asked of them and a
 *        summary of the entry. The token is the authentication.
 *   POST signs and locks the entry. The signer's full name is required; a licence
 *        number is optional. The token is single-use.
 * No session is required; possession of the unguessable token authorises this
 * one entry only.
 */
const Body = z.object({
  signerName: z.string().min(1),
  signerLicense: z.string().optional(),
  signatureImage: z.string().startsWith("data:image/").max(300_000).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = String(req.query.token);

  if (req.method === "GET") {
    const request = await getSignoffRequestByToken(token);
    if (!request) {
      res.status(404).json({ error: "This signing link is invalid, already used, or expired." });
      return;
    }
    const version = await getCurrentVersion(request.entryId);
    const cols = (version?.content?.columns ?? {}) as Record<string, unknown>;
    const aircraft = (version?.content?.aircraft ?? {}) as { makeModelVariant?: string; registration?: string };
    res.status(200).json({
      capacity: request.capacity,
      signerName: request.signerName,
      entry: {
        date: cols.date ?? null,
        departurePlace: cols.departurePlace ?? null,
        arrivalPlace: cols.arrivalPlace ?? null,
        total: cols.total ?? null,
        picName: version?.content?.picName ?? null,
        aircraft: `${aircraft.makeModelVariant ?? ""} (${aircraft.registration ?? ""})`,
        locked: Boolean(version?.locked),
      },
    });
    return;
  }

  if (req.method === "POST") {
    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Your full name is required to sign." });
      return;
    }
    try {
      const { entryId } = await signEntryExternal(token, {
        signerName: parsed.data.signerName,
        ...(parsed.data.signerLicense ? { signerLicense: parsed.data.signerLicense } : {}),
        ...(parsed.data.signatureImage ? { signatureImage: parsed.data.signatureImage } : {}),
      });
      res.status(200).json({ locked: true, entryId });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "Could not sign." });
    }
    return;
  }

  res.status(405).json({ error: "Use GET or POST." });
}
