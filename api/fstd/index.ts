import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseFstdRequest } from "../../src/http/parseFstd.js";
import { RequestError } from "../../src/http/parseEntry.js";
import { validateFstdSession } from "../../src/domain/validation.js";
import { createFstdEntry } from "../../src/db/repository.js";
import { validateFstdReferences } from "../../src/http/validateReferences.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/**
 * Record a synthetic training (FSTD) session for the signed-in holder. As with
 * flight entries, the holder id comes from the session, not the request body.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  try {
    const claims = await requireUser(req);
    const raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const input = parseFstdRequest({ ...(raw as object), pilotId: claims.sub });
    const result = validateFstdSession(input);
    if (!result.valid || !result.derived) {
      res.status(422).json({ valid: false, issues: result.issues });
      return;
    }
    const refIssues = await validateFstdReferences(input);
    if (refIssues.length > 0) {
      res.status(422).json({ valid: false, issues: refIssues });
      return;
    }
    const created = await createFstdEntry(input, result.derived, claims.sub);
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}
