import type { VercelRequest, VercelResponse } from "@vercel/node";
import { revokeImportToken } from "../../../src/db/importTokensRepository.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/**
 * Revoke a personal access token. Revocation is irreversible: the token row
 * stays for the audit trail (so past imports remain attributable) but the token
 * itself can no longer authenticate.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);

    if (req.method !== "DELETE") {
      res.status(405).json({ error: "Use DELETE." });
      return;
    }

    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id) {
      res.status(400).json({ error: "Missing token id." });
      return;
    }
    const ok = await revokeImportToken(claims.sub, id);
    if (!ok) {
      res.status(404).json({ error: "Token not found or already revoked." });
      return;
    }
    res.status(204).end();
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
