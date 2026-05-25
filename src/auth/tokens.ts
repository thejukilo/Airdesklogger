/**
 * Session tokens (JWT, HS256).
 *
 * Sessions are short lived and stateless. The secret is passed in rather than
 * read from the environment here, so the functions stay easy to test and the
 * deployment controls where the secret comes from. Tokens carry the user id and
 * the roles, which is enough for the authorisation checks in roles.ts.
 */

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./roles.js";

export interface SessionClaims {
  sub: string; // user id
  roles: Role[];
  email: string;
}

const ISSUER = "airdesklogger";
const AUDIENCE = "airdesklogger:api";

function keyFrom(secret: string): Uint8Array {
  if (secret.length < 32) {
    throw new Error("Session secret must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(
  claims: SessionClaims,
  secret: string,
  expiresIn: string = "8h",
): Promise<string> {
  return new SignJWT({ roles: claims.roles, email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(expiresIn)
    .sign(keyFrom(secret));
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, keyFrom(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return {
    sub: String(payload.sub),
    roles: (payload.roles as Role[]) ?? [],
    email: String(payload.email ?? ""),
  };
}
