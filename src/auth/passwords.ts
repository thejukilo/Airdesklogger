/**
 * Password hashing with Argon2id.
 *
 * We use the WASM build of Argon2id (hash-wasm) rather than a native addon so
 * the same code runs in development, in tests, and inside a Vercel serverless
 * function without a compile step or a platform-specific binary to ship. The
 * parameters below follow current OWASP guidance for Argon2id; they can be
 * raised later without invalidating existing hashes, because the cost factors
 * are encoded in the stored hash string.
 */

import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

const PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 19456, // KiB, about 19 MB
  hashLength: 32,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }
  return argon2id({
    password,
    salt: randomBytes(16),
    ...PARAMS,
    outputType: "encoded",
  });
}

/** Verify a password against an encoded Argon2id hash. Never throws on mismatch. */
export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}
