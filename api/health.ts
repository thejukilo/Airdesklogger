import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Liveness check. Confirms the function runtime is up and reports the time in UTC. */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    status: "ok",
    service: "airdesklogger",
    time: new Date().toISOString(),
  });
}
