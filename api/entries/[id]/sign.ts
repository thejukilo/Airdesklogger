import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { verifyTotp } from "../../../src/auth/totp.js";
import { unwrapPrivateKey } from "../../../src/auth/signingKeys.js";
import { canSignAs, type SignerCapacity } from "../../../src/auth/roles.js";
import { getUserById, logAccountEvent, type UserRow } from "../../../src/db/authRepository.js";
import { getEntryMeta, signCurrentVersion } from "../../../src/db/repository.js";
import { signEntry } from "../../../src/domain/signature.js";
import { getSigningMasterKey } from "../../../src/config.js";
import { requireUser, AuthError, clientIp, type IncomingLike } from "../../../src/http/auth.js";

/**
 * Counter-sign one entry, or several at once, which permanently locks them.
 *
 * This is the one action that demands the second factor. The signer must hold a
 * role that permits the requested capacity, must have MFA active, and must
 * present a valid current code. A signer cannot certify their own logbook. On a
 * good code the signer's own wrapped key is unwrapped just long enough to sign,
 * each signature is verified before storage, and the step-up is recorded.
 *
 * Routes: POST /api/entries/{id}/sign signs one entry; POST /api/entries/batch/sign
 * with { entryIds: [...] } signs several after a single step-up (FOCA 2.4.2).
 */
const Body = z.object({
  code: z.string().min(6).max(8),
  role: z.enum(["INSTRUCTOR", "EXAMINER", "SUPERVISING_PIC", "ATO", "DTO", "HOT", "AIRPORT", "OTHER"]),
  entryIds: z.array(z.string()).optional(),
  // A drawn signature is part of the regulatory record. Capped so a request stays small.
  signatureImage: z.string().startsWith("data:image/", "A drawn signature is required.").max(300_000),
  // The place the signer is signing at (an aerodrome name or freeform location).
  signedPlace: z.string().trim().min(1, "Place of signing is required.").max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const routeId = String(req.query.id);
  try {
    const claims = await requireUser(req);
    const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Provide a code, role, place and signature to sign." });
      return;
    }
    const { code, role } = parsed.data;

    const targets = routeId === "batch" ? parsed.data.entryIds ?? [] : [routeId];
    if (targets.length === 0) {
      res.status(400).json({ error: "No entries to sign." });
      return;
    }

    const user = await getUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (!canSignAs(user.roles, role as SignerCapacity)) {
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

    // One step-up authorises the whole request.
    const ip = clientIp(req as IncomingLike);
    const ipField = ip !== undefined ? { ip } : {};
    const masterKey = getSigningMasterKey();
    if (!verifyTotp(code, unwrapPrivateKey(user.mfaSecretWrapped, masterKey))) {
      await logAccountEvent({ userId: user.id, eventType: "SIGN_STEP_UP_FAILED", detail: { targets }, ...ipField });
      res.status(401).json({ error: "Second-factor code did not match." });
      return;
    }
    await logAccountEvent({ userId: user.id, eventType: "SIGN_STEP_UP", detail: { targets, role }, ...ipField });

    const keys = {
      privateKey: unwrapPrivateKey(user.signingKeyWrapped, masterKey),
      publicKey: user.signingPublicKey,
    };

    const results = [];
    for (const entryId of targets) {
      results.push(await signOne(entryId, user, role as SignerCapacity, keys, parsed.data.signatureImage, parsed.data.signedPlace));
    }

    const allOk = results.every((r) => r.ok);
    // A single-entry request keeps the original response shape.
    if (routeId !== "batch") {
      const only = results[0]!;
      res.status(only.ok ? 200 : only.status ?? 400).json(only.ok ? { locked: true, signature: only.signature } : { error: only.error });
      return;
    }
    res.status(allOk ? 200 : 207).json({ results });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

interface SignResult {
  entryId: string;
  ok: boolean;
  status?: number;
  error?: string;
  signature?: unknown;
}

async function signOne(
  entryId: string,
  user: UserRow,
  role: SignerCapacity,
  keys: { privateKey: string; publicKey: string },
  signatureImage?: string,
  signedPlace?: string,
): Promise<SignResult> {
  const meta = await getEntryMeta(entryId);
  if (!meta) return { entryId, ok: false, status: 404, error: "Entry not found." };
  if (meta.pilotId === user.id) {
    return { entryId, ok: false, status: 403, error: "You cannot countersign your own logbook entry." };
  }
  if (meta.locked) return { entryId, ok: false, status: 409, error: "Entry is already locked." };

  // Record the licence appropriate to the capacity being signed.
  const license =
    role === "EXAMINER"
      ? user.examinerCertificate
      : role === "INSTRUCTOR"
        ? user.instructorCertificate
        : user.licenseNumber;

  const signature = await signCurrentVersion(
    entryId,
    keys,
    {
      signerId: user.id,
      signerRole: role,
      signerName: user.name,
      ...(user.email ? { signerEmail: user.email } : {}),
      ...(license ? { signerLicense: license } : {}),
      ...(signatureImage ? { signatureImage } : {}),
      ...(signedPlace ? { signedPlace } : {}),
    },
    signEntry,
  );
  return {
    entryId,
    ok: true,
    signature: {
      entryId: signature.entryId,
      contentHash: signature.contentHash,
      signerId: signature.signerId,
      signerRole: signature.signerRole,
      signedAt: signature.signedAt,
      signature: signature.signature,
      publicKey: signature.publicKey,
    },
  };
}
