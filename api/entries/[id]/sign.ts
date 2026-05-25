import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { verifyTotp } from "../../../src/auth/totp.js";
import { unwrapPrivateKey } from "../../../src/auth/signingKeys.js";
import { canSignAs } from "../../../src/auth/roles.js";
import { getUserById, logAccountEvent } from "../../../src/db/authRepository.js";
import { getEntryMeta, signCurrentVersion } from "../../../src/db/repository.js";
import { signEntry } from "../../../src/domain/signature.js";
import { getSigningMasterKey } from "../../../src/config.js";
import { requireUser, AuthError, clientIp } from "../../../src/http/auth.js";

/**
 * Counter-sign an entry, which permanently locks it.
 *
 * This is the one action that demands the second factor. The signer must hold a
 * role that permits the requested capacity, must have MFA active, and must
 * present a valid current code. A signer cannot certify their own logbook. On a
 * good code the signer's own wrapped key is unwrapped just long enough to sign,
 * the signature is verified before storage, and the step-up is recorded in the
 * security log either way.
 */
const Body = z.object({
  code: z.string().min(6).max(8),
  role: z.enum(["INSTRUCTOR", "EXAMINER", "SUPERVISING_PIC"]),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const entryId = String(req.query.id);
  try {
    const claims = await requireUser(req);
    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide 'code' and a 'role' to sign as." });
      return;
    }
    const { code, role } = parsed.data;

    const user = await getUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (!canSignAs(user.roles, role)) {
      res.status(403).json({ error: `Your roles do not permit signing as ${role}.` });
      return;
    }
    if (!user.mfaEnabled || !user.mfaSecretWrapped) {
      res.status(403).json({ error: "Enable multi-factor authentication before signing." });
      return;
    }
    if (!user.signingKeyWrapped || !user.signingPublicKey) {
      res.status(409).json({ error: "No signing key is provisioned for this account." });
      return;
    }

    const meta = await getEntryMeta(entryId);
    if (!meta) {
      res.status(404).json({ error: "Entry not found." });
      return;
    }
    if (meta.pilotId === user.id) {
      res.status(403).json({ error: "You cannot countersign your own logbook entry." });
      return;
    }
    if (meta.locked) {
      res.status(409).json({ error: "Entry is already locked." });
      return;
    }

    const ip = clientIp(req);
    const ipField = ip !== undefined ? { ip } : {};
    const masterKey = getSigningMasterKey();
    const mfaSecret = unwrapPrivateKey(user.mfaSecretWrapped, masterKey);
    if (!verifyTotp(code, mfaSecret)) {
      await logAccountEvent({ userId: user.id, eventType: "SIGN_STEP_UP_FAILED", detail: { entryId }, ...ipField });
      res.status(401).json({ error: "Second-factor code did not match." });
      return;
    }
    await logAccountEvent({ userId: user.id, eventType: "SIGN_STEP_UP", detail: { entryId, role }, ...ipField });

    const keys = {
      privateKey: unwrapPrivateKey(user.signingKeyWrapped, masterKey),
      publicKey: user.signingPublicKey,
    };
    const signature = await signCurrentVersion(
      entryId,
      keys,
      { signerId: user.id, signerRole: role },
      signEntry,
    );

    res.status(200).json({
      locked: true,
      signature: {
        entryId: signature.entryId,
        contentHash: signature.contentHash,
        signerId: signature.signerId,
        signerRole: signature.signerRole,
        signedAt: signature.signedAt,
        signature: signature.signature,
        publicKey: signature.publicKey,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}
