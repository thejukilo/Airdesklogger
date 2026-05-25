/**
 * Per-signer signing keys, bound to the signer's identity.
 *
 * Each instructor or examiner has their own Ed25519 key pair. The public key is
 * stored in the clear so signatures stay verifiable for the life of the record.
 * The private key is never stored in the clear: it is wrapped with AES-256-GCM
 * under a server master key before it touches the database, and it is only
 * unwrapped at the moment of signing, after the signer has passed the
 * second-factor step-up. The master key comes from the environment, not the
 * database, so a database leak alone does not expose any private key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generateSigningKeyPair } from "../domain/signature.js";

const VERSION = "v1";

function masterKey(masterKeyHex: string): Buffer {
  const key = Buffer.from(masterKeyHex, "hex");
  if (key.length !== 32) {
    throw new Error("AUTH_SIGNING_MASTER_KEY must be 32 bytes (64 hex characters).");
  }
  return key;
}

/** Encrypt a PEM private key for storage. Returns a single self-describing string. */
export function wrapPrivateKey(privateKeyPem: string, masterKeyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(masterKeyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function unwrapPrivateKey(wrapped: string, masterKeyHex: string): string {
  const [version, ivB64, tagB64, dataB64] = wrapped.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Wrapped private key is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(masterKeyHex), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Generate a new signing key pair, returning the public key and the wrapped private key. */
export function provisionSigningKeypair(masterKeyHex: string): {
  publicKey: string;
  wrappedPrivateKey: string;
} {
  const { publicKey, privateKey } = generateSigningKeyPair();
  return { publicKey, wrappedPrivateKey: wrapPrivateKey(privateKey, masterKeyHex) };
}
