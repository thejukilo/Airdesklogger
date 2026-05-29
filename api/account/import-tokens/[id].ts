import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  revokeImportToken,
  updateImportTokenPrefs,
} from "../../../src/db/importTokensRepository.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/**
 * Per-token operations.
 *   DELETE revokes the token irreversibly. The row stays for the audit trail
 *          (so past imports remain attributable) but the secret no longer
 *          authenticates.
 *   PATCH  edits the per-token preferences (name, source/store time zone, TMG
 *          filing) without rotating the secret. Revoked tokens cannot be edited.
 */
const PatchBody = z.object({
  name: z.string().min(1).max(64).optional(),
  sourceTimeZone: z.enum(["UTC", "LOCAL"]).optional(),
  storeTimeZone: z.enum(["UTC", "LOCAL"]).optional(),
  tmgCategory: z.enum(["AEROPLANE", "SAILPLANE"]).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id) {
      res.status(400).json({ error: "Missing token id." });
      return;
    }

    if (req.method === "DELETE") {
      const ok = await revokeImportToken(claims.sub, id);
      if (!ok) {
        res.status(404).json({ error: "Token not found or already revoked." });
        return;
      }
      res.status(204).end();
      return;
    }

    if (req.method === "PATCH") {
      const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
      const parsed = PatchBody.safeParse(body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid update." });
        return;
      }
      const row = await updateImportTokenPrefs(claims.sub, id, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.sourceTimeZone !== undefined ? { sourceTimeZone: parsed.data.sourceTimeZone } : {}),
        ...(parsed.data.storeTimeZone !== undefined ? { storeTimeZone: parsed.data.storeTimeZone } : {}),
        ...(parsed.data.tmgCategory !== undefined ? { tmgCategory: parsed.data.tmgCategory } : {}),
      });
      if (!row) {
        res.status(404).json({ error: "Token not found, revoked, or no change requested." });
        return;
      }
      res.status(200).json({ row });
      return;
    }

    res.status(405).json({ error: "Use DELETE or PATCH." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
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
