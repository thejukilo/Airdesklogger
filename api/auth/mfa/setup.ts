import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateTotpSecret, otpauthUri } from "../../../src/auth/totp.js";
import { wrapPrivateKey } from "../../../src/auth/signingKeys.js";
import { setMfaSecret, getUserById, logAccountEvent } from "../../../src/db/authRepository.js";
import { getSigningMasterKey } from "../../../src/config.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/**
 * Begin enrolling a second factor. Generates a TOTP secret, stores it wrapped
 * (the same encryption used for signing keys), and returns the otpauth URI for
 * the user's authenticator app. The factor is not active until activate.ts
 * confirms a code, so a half-finished setup cannot lock anyone out.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  try {
    const claims = await requireUser(req);
    const user = await getUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const secret = generateTotpSecret();
    await setMfaSecret(user.id, wrapPrivateKey(secret, getSigningMasterKey()));
    await logAccountEvent({ userId: user.id, eventType: "MFA_SETUP" });

    res.status(200).json({
      secret,
      otpauthUri: otpauthUri(secret, user.email ?? user.id, "AirdeskLogger"),
      note: "Add this to an authenticator app, then confirm a code at /api/auth/mfa/activate.",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
