import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseEntryRequest, RequestError } from "../src/http/parseEntry.js";
import { validateEntry } from "../src/domain/validation.js";
import { toUtcIso } from "../src/domain/time.js";

/**
 * Validate a single logbook entry and return the derived twelve-column values.
 * No database is touched, so this works on a fresh deployment with no storage
 * configured. POST a JSON entry; non-UTC times are rejected with 400 and
 * regulatory rule failures come back as 422 with a list of issues.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST with a JSON flight entry." });
    return;
  }
  try {
    const input = parseEntryRequest(req.body);
    const result = validateEntry(input);
    const derived = result.derived
      ? {
          ...result.derived,
          departureTime: toUtcIso(result.derived.departureTime),
          arrivalTime: toUtcIso(result.derived.arrivalTime),
        }
      : undefined;
    res.status(result.valid ? 200 : 422).json({
      valid: result.valid,
      issues: result.issues,
      derived,
    });
  } catch (err) {
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}
