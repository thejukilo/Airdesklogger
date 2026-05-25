import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../../src/auth/totp.js";
import { wrapPrivateKey, unwrapPrivateKey } from "../../../src/auth/signingKeys.js";
import { setMfaSecret, activateMfa, getUserById, logAccountEvent } from "../../../src/db/authRepository.js";
import { getSigningMasterKey } from "../../../src/config.js";
import { requireUser, AuthError } from "../../../src/http/auth.js";

/**
 * Multi-factor enrolment, dispatched by the path segment so the two steps share
 * one serverless function. Public URLs unchanged: /api/auth/mfa/setup and
 * /api/auth/mfa/activate.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  try {
    const claims = await requireUser(req);
    switch (String(req.query.action)) {
      case "setup":
        return await setup(claims.sub, res);
      case "activate":
        return await activate(claims.sub, req, res);
      default:
        res.status(404).json({ error: "Unknown MFA action." });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

async function setup(userId: string, res: VercelResponse): Promise<void> {
  const user = await getUserById(userId);
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
}

const ActivateBody = z.object({ code: z.string().min(6).max(8) });

async function activate(userId: string, req: VercelRequest, res: VercelResponse): Promise<void> {
  const parsed = ActivateBody.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A 'code' from the authenticator app is required." });
    return;
  }
  const user = await getUserById(userId);
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
}
