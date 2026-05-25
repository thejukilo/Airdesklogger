/**
 * Cryptographic sign-off (Ed25519).
 *
 * When an instructor or examiner certifies a training flight or skill test, they
 * sign over a canonical payload that binds: the entry id, the exact content hash
 * being attested, the signer and their role, and the UTC time of signing. A valid
 * signature locks the entry: once a lock exists the persistence layer refuses
 * any further version, which satisfies "permanently locked from future editing".
 *
 * Keys are never generated or held here implicitly: callers pass keys in, so the
 * deployment can source the private key from a KMS / env and store only public
 * keys in the database for later verification.
 */

import {
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from "node:crypto";

export type SignerRole = "INSTRUCTOR" | "EXAMINER" | "SUPERVISING_PIC";

export interface SigningPayload {
  entryId: string;
  /** The content hash (from hashChain.hashContent) being attested. */
  contentHash: string;
  signerId: string;
  signerRole: SignerRole;
  signedAt: string; // UTC ISO
}

export interface Signature extends SigningPayload {
  /** base64 Ed25519 signature over the canonical payload. */
  signature: string;
  /** PEM SPKI public key, stored for verification. */
  publicKey: string;
}

/** Generate an Ed25519 keypair as PEM strings. */
export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function canonicalPayload(p: SigningPayload): Buffer {
  // Fixed field order, because both signer and verifier must serialize identically.
  return Buffer.from(
    JSON.stringify([p.entryId, p.contentHash, p.signerId, p.signerRole, p.signedAt]),
    "utf8",
  );
}

export function signEntry(privateKeyPem: string, payload: SigningPayload): string {
  const key: KeyObject = createPrivateKey(privateKeyPem);
  return edSign(null, canonicalPayload(payload), key).toString("base64");
}

export function verifySignature(sig: Signature): boolean {
  try {
    const key = createPublicKey(sig.publicKey);
    const { signature, publicKey, ...payload } = sig;
    return edVerify(null, canonicalPayload(payload), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Convenience: produce a complete, verifiable Signature in one call. */
export function createSignature(
  keys: { privateKey: string; publicKey: string },
  payload: SigningPayload,
): Signature {
  return {
    ...payload,
    signature: signEntry(keys.privateKey, payload),
    publicKey: keys.publicKey,
  };
}
