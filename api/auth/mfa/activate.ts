import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { verifyTotp } from "../../../src/auth/totp.js";
import { unwrapPrivateKey } from "../../../src/auth/signingKeys.js";
import { activateMfa, getUserById, logAccountEvent } from "../../../src/db/authRepository.js";
import { getSigningMasterKey } from "../../../src/config.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/** Confirm a TOTP code to turn the second factor on for this account. */
const Body = z.object({ code: z.string().min(6).max(8) });

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  try {
    const claims = await requireUser(req);
    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A 'code' from the authenticator app is required." });
      return;
    }
    const user = await getUserById(claims.sub);
    if (!user || !user.mfaSecretWrapped) {
      res.status(409).json({ error: "Start MFA setup first." });
      return;
    }

    const secret = unwrapPrivateKey(user.mfaSecretWrapped, getSigningMasterKey());
    if (!verifyTotp(parsed.data.code, secret)) {
      res.status(400).json({ error: "That code did not match." });
      return;
    }

    await activateMfa(user.id);
    await logAccountEvent({ userId: user.id, eventType: "MFA_ACTIVATED" });
    res.status(200).json({ mfaEnabled: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
