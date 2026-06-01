/**
 * Request-side authentication helpers.
 *
 * requireUser pulls the bearer token off the request, verifies it, and returns
 * the session claims. Handlers call it at the top and let an AuthError turn into
 * the right HTTP status. The request type is kept as a minimal structural shape
 * so this stays testable without constructing a full framework request.
 */

import { verifySession, type SessionClaims } from "../auth/tokens.js";
import { getJwtSecret } from "../config.js";
import { userCanWrite } from "../db/subscriptionRepository.js";

export interface IncomingLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined } | undefined;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function header(req: IncomingLike, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function bearerToken(req: IncomingLike): string | null {
  const auth = header(req, "authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1]!.trim() : null;
}

export async function requireUser(req: IncomingLike): Promise<SessionClaims> {
  const token = bearerToken(req);
  if (!token) throw new AuthError("Missing bearer token.");
  try {
    return await verifySession(token, getJwtSecret());
  } catch {
    throw new AuthError("Invalid or expired session.");
  }
}

/**
 * Throws AuthError 402 (Payment Required) when the holder's subscription
 * state does not allow writes. Called by every write endpoint at the same
 * point as requireUser. Read endpoints and DELETE-as-void are intentionally
 * not gated - the holder can always view and clean up their own data.
 */
export async function requireWriteCapability(userId: string): Promise<void> {
  const ok = await userCanWrite(userId);
  if (!ok) {
    throw new AuthError(
      "Your trial has ended. Subscribe to keep logging flights.",
      402,
    );
  }
}

/** Best-effort client IP for the security log. */
export function clientIp(req: IncomingLike): string | undefined {
  const fwd = header(req, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.socket?.remoteAddress;
}
