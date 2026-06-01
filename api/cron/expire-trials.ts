import type { VercelRequest, VercelResponse } from "@vercel/node";
import { expireFinishedTrials } from "../../src/db/subscriptionRepository.js";

/**
 * Daily cron: flip every trial whose trial_ends_at has passed to read_only.
 * Vercel Cron invokes this endpoint with a header carrying CRON_SECRET; we
 * reject anything else so a public hit can't trigger the sweep.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Use POST or GET." });
    return;
  }
  const secret = process.env.CRON_SECRET;
  // Vercel attaches Authorization: Bearer <CRON_SECRET> automatically when a
  // crons[] entry is configured; in dev a manual hit works without if the env
  // var isn't set.
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Bad cron secret." });
      return;
    }
  }
  try {
    const expired = await expireFinishedTrials();
    res.status(200).json({ ok: true, expired, ranAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
