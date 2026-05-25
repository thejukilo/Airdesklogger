import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getLedger } from "../../src/db/repository.js";
import { verifyChain } from "../../src/domain/hashChain.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/**
 * Verify the integrity of the whole audit ledger. The ledger spans every
 * holder's activity, so this is restricted to administrators. It recomputes the
 * hash chain and reports whether it is intact, and if not, where it broke.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  try {
    const claims = await requireUser(req);
    if (!claims.roles.includes("ADMIN")) {
      res.status(403).json({ error: "Administrator role required." });
      return;
    }
    const ledger = await getLedger();
    const result = verifyChain(ledger);
    res.status(200).json({ records: ledger.length, ...result });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
