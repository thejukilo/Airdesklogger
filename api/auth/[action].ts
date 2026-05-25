import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../src/auth/passwords.js";
import { signSession } from "../../src/auth/tokens.js";
import { provisionSigningKeypair } from "../../src/auth/signingKeys.js";
import { isRole, type Role } from "../../src/auth/roles.js";
import {
  createUser,
  getUserByEmail,
  verifyEmailByToken,
  logAccountEvent,
} from "../../src/db/authRepository.js";
import { getJwtSecret, getSigningMasterKey } from "../../src/config.js";
import { clientIp } from "../../src/http/auth.js";

/**
 * Account actions, dispatched by the path segment so they share one serverless
 * function (the Vercel Hobby plan caps the number of functions). The public URLs
 * are unchanged: /api/auth/register, /api/auth/login, /api/auth/verify-email.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    switch (String(req.query.action)) {
      case "register":
        return await register(req, res);
      case "login":
        return await login(req, res);
      case "verify-email":
        return await verifyEmail(req, res);
      default:
        res.status(404).json({ error: "Unknown auth action." });
    }
  } catch (err) {
    // Always answer with JSON, even on an unexpected failure, so the client never
    // has to parse a platform error page. The detail goes to the server log, not
    // the response.
    console.error("auth handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error. Please try again." });
    }
  }
}

function body(req: VercelRequest): unknown {
  return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

// ---- register -----------------------------------------------------------------

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd").optional(),
  licenseNumber: z.string().optional(),
  address: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

async function register(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = RegisterBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const { email, password, name, firstName, lastName, dateOfBirth, licenseNumber, address } = parsed.data;

  let roles: Role[] = ["PILOT"];
  if (parsed.data.roles && parsed.data.roles.length > 0) {
    const bootstrap = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!bootstrap || req.headers["x-admin-bootstrap"] !== bootstrap) {
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
  const emailVerificationToken = randomBytes(24).toString("base64url");

  const user = await createUser({
    email,
    passwordHash,
    name,
    roles,
    emailVerificationToken,
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
    ...(licenseNumber !== undefined ? { licenseNumber } : {}),
    ...(address !== undefined ? { address } : {}),
    signingPublicKey: publicKey,
    signingKeyWrapped: wrappedPrivateKey,
  });

  const ip = clientIp(req);
  await logAccountEvent({ userId: user.id, email, eventType: "REGISTER", ...(ip !== undefined ? { ip } : {}) });
  // The token is returned here for wiring an email step; in production it is sent
  // to the address rather than returned in the response.
  res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    emailVerificationToken,
  });
}

// ---- login --------------------------------------------------------------------

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

async function login(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = LoginBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const ip = clientIp(req);
  const ipField = ip !== undefined ? { ip } : {};
  const user = await getUserByEmail(parsed.data.email);

  if (!user || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await logAccountEvent({ email: parsed.data.email, eventType: "LOGIN_FAILED", ...ipField });
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = await signSession(
    { sub: user.id, roles: user.roles, email: user.email ?? "" },
    getJwtSecret(),
  );
  await logAccountEvent({ userId: user.id, email: user.email ?? "", eventType: "LOGIN_SUCCESS", ...ipField });

  res.status(200).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, roles: user.roles },
    mfaEnabled: user.mfaEnabled,
  });
}

// ---- verify-email -------------------------------------------------------------

const VerifyBody = z.object({ token: z.string().min(1) });

async function verifyEmail(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = VerifyBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: "A verification token is required." });
    return;
  }
  const userId = await verifyEmailByToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "Invalid or already-used verification token." });
    return;
  }
  res.status(200).json({ emailVerified: true });
}
