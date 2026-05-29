import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  createImportToken,
  listImportTokens,
} from "../../../src/db/importTokensRepository.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/**
 * Personal access tokens used by the Import API (entries:append scope).
 *   GET  lists the holder's tokens (prefix + name + last used, never the secret).
 *   POST mints a new token. The raw secret is returned exactly once in this
 *        response and never persisted; the storage layer keeps only its hash.
 */
const CreateBody = z.object({
  name: z.string().min(1).max(64),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);

    if (req.method === "GET") {
      const tokens = await listImportTokens(claims.sub);
      res.status(200).json({ tokens });
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
      const parsed = CreateBody.safeParse(body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid token name." });
        return;
      }
      const created = await createImportToken(claims.sub, parsed.data.name.trim());
      res.status(201).json({ token: created.token, row: created.row });
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
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
