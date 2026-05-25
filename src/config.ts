/**
 * Reads the secrets the auth layer needs from the environment, and fails loudly
 * if they are missing or too weak. Keeping this in one place means a handler
 * never reads process.env directly, and a misconfigured deployment is caught at
 * the first request rather than producing silently insecure behaviour.
 *
 * Required environment variables:
 *   AUTH_JWT_SECRET          at least 32 characters; signs session tokens.
 *   AUTH_SIGNING_MASTER_KEY  64 hex characters (32 bytes); wraps signing keys.
 */

export function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_JWT_SECRET is missing or shorter than 32 characters.");
  }
  return secret;
}

export function getSigningMasterKey(): string {
  const key = process.env.AUTH_SIGNING_MASTER_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("AUTH_SIGNING_MASTER_KEY is missing or not 64 hex characters.");
  }
  return key;
}
