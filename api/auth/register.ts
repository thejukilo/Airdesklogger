import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { hashPassword } from "../../src/auth/passwords.js";
import { provisionSigningKeypair } from "../../src/auth/signingKeys.js";
import { isRole, type Role } from "../../src/auth/roles.js";
import { createUser, getUserByEmail, logAccountEvent } from "../../src/db/authRepository.js";
import { getSigningMasterKey } from "../../src/config.js";
import { clientIp } from "../../src/http/auth.js";

/**
 * Create an account. Anyone may register as a PILOT. Elevated roles (instructor,
 * examiner, admin) are only granted when a valid bootstrap token is presented,
 * so a user cannot make themselves an examiner. In production that token belongs
 * to an administrator and self-registration stays pilot-only.
 *
 * Every account gets its own Ed25519 signing key pair on creation; the private
 * key is wrapped before storage and only the public key is kept in the clear.
 */
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
  licenseNumber: z.string().optional(),
  address: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = Body.safeParse(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const { email, password, name, licenseNumber, address } = parsed.data;

  let roles: Role[] = ["PILOT"];
  if (parsed.data.roles && parsed.data.roles.length > 0) {
    const bootstrap = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const presented = req.headers["x-admin-bootstrap"];
    if (!bootstrap || presented !== bootstrap) {
      res.status(403).json({ error: "Elevated roles require a valid bootstrap token." });
      return;
    }
    const requested = parsed.data.roles.filter(isRole) as Role[];
    roles = Array.from(new Set<Role>(["PILOT", ...requested]));
  }

  if (await getUserByEmail(email)) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = await hashPassword(password);
  const { publicKey, wrappedPrivateKey } = provisionSigningKeypair(getSigningMasterKey());

  const user = await createUser({
    email,
    passwordHash,
    name,
    roles,
    ...(licenseNumber !== undefined ? { licenseNumber } : {}),
    ...(address !== undefined ? { address } : {}),
    signingPublicKey: publicKey,
    signingKeyWrapped: wrappedPrivateKey,
  });

  await logAccountEvent({ userId: user.id, email, eventType: "REGISTER", ...ipOf(req) });
  res.status(201).json({ id: user.id, email: user.email, name: user.name, roles: user.roles });
}

function ipOf(req: VercelRequest): { ip?: string } {
  const ip = clientIp(req);
  return ip !== undefined ? { ip } : {};
}
