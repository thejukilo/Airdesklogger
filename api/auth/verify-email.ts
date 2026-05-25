import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { verifyEmailByToken } from "../../src/db/authRepository.js";

/**
 * Confirm an email address from the token issued at registration. FOCA 2.1.3
 * requires user identity to be verified at least through a confirmed email
 * address. Email delivery is wired separately; this endpoint consumes the token.
 */
const Body = z.object({ token: z.string().min(1) });

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A verification token is required." });
    return;
  }
  const userId = await verifyEmailByToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "Invalid or already-used verification token." });
    return;
  }
  res.status(200).json({ emailVerified: true });
}
