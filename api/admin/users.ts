import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { listUsersForAdmin } from "../../src/db/subscriptionRepository.js";
import { getUserById } from "../../src/db/authRepository.js";
import { verifyTotp } from "../../src/auth/totp.js";
import { unwrapPrivateKey } from "../../src/auth/signingKeys.js";
import { getSigningMasterKey } from "../../src/config.js";

/**
 * Admin: list every user with their subscription state, trial countdown,
 * flight count, last activity, and MFA status. Two-stage gate:
 *
 *   1. Caller's session must carry the ADMIN role.
 *   2. Caller must present a current TOTP code in the X-MFA-Code header.
 *      MFA must be enrolled on the admin account; if it isn't, the endpoint
 *      refuses with 428 so the SPA prompts enrolment first.
 *
 * The TOTP secret is unwrapped from the admin's account row and verified
 * exactly the same way the sign-off step-up does it, so the security profile
 * is the same as countersigning an entry. No "remember this device" — every
 * admin GET re-prompts for the code.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  try {
    const claims = await requireUser(req);
    if (!claims.roles.includes("ADMIN")) {
      res.status(403).json({ error: "Administrator access required." });
      return;
    }
    const me = await getUserById(claims.sub);
    if (!me) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (!me.mfaEnabled || !me.mfaSecretWrapped) {
      res.status(428).json({ error: "Enroll in two-factor authentication before opening the admin area." });
      return;
    }
    const code = String(req.headers["x-mfa-code"] ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      res.status(401).json({ error: "Provide a 6-digit code from your authenticator." });
      return;
    }
    const secret = unwrapPrivateKey(me.mfaSecretWrapped, getSigningMasterKey());
    if (!verifyTotp(code, secret)) {
      res.status(401).json({ error: "That code did not match. Try again with the current one." });
      return;
    }
    const users = await listUsersForAdmin();
    res.status(200).json({ users });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not load users." });
  }
}
