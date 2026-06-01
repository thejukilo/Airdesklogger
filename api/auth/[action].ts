import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../src/auth/passwords.js";
import { verifyTotp } from "../../src/auth/totp.js";
import { unwrapPrivateKey } from "../../src/auth/signingKeys.js";
import { signSession } from "../../src/auth/tokens.js";
import { provisionSigningKeypair } from "../../src/auth/signingKeys.js";
import { isRole, type Role } from "../../src/auth/roles.js";
import {
  createUser,
  getUserByEmail,
  verifyEmailByToken,
  setEmailVerificationToken,
  setPasswordResetToken,
  consumePasswordReset,
  logAccountEvent,
} from "../../src/db/authRepository.js";
import { getJwtSecret, getSigningMasterKey } from "../../src/config.js";
import { clientIp } from "../../src/http/auth.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../../src/http/email.js";

function origin(req: VercelRequest): string {
  return process.env.APP_BASE_URL ?? `https://${req.headers.host}`;
}
/** The address a verification link points at, from config or the request host. */
function verificationLink(req: VercelRequest, token: string): string {
  return `${origin(req)}/verify?token=${encodeURIComponent(token)}`;
}
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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
      case "resend-verification":
        return await resendVerification(req, res);
      case "request-password-reset":
        return await requestPasswordReset(req, res);
      case "reset-password":
        return await resetPassword(req, res);
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
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth is required (yyyy-mm-dd)."),
  addressStreet: z.string().min(1, "Street and number are required."),
  addressZip: z.string().min(1, "ZIP and place are required."),
  addressCountry: z.string().min(1, "Country is required."),
  licenseNumber: z.string().optional(),
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
  const { email, password, firstName, lastName, dateOfBirth, addressStreet, addressZip, addressCountry, licenseNumber } = parsed.data;
  // EASA/FOCA 2.1.3 requires the holder's identity (forenames, surname, date of
  // birth, address) saved on the account; the display name is the two names.
  const name = `${firstName} ${lastName}`.trim();

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
    firstName,
    lastName,
    dateOfBirth,
    addressStreet,
    addressZip,
    addressCountry,
    roles,
    emailVerificationToken,
    ...(licenseNumber !== undefined ? { licenseNumber } : {}),
    signingPublicKey: publicKey,
    signingKeyWrapped: wrappedPrivateKey,
  });

  const ip = clientIp(req);
  await logAccountEvent({ userId: user.id, email, eventType: "REGISTER", ...(ip !== undefined ? { ip } : {}) });

  // Send the confirmation email if SMTP is configured. When the email was
  // delivered, the verification token is NOT returned to the client - the
  // holder must open the email to confirm ownership of the address. Only in
  // a non-production / no-SMTP setup, where the email cannot be delivered,
  // do we fall back to surfacing the token so a developer can complete the
  // flow on screen.
  const emailed = await sendVerificationEmail({
    to: email,
    name: user.name,
    link: verificationLink(req, emailVerificationToken),
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    emailed,
    ...(emailed ? {} : { emailVerificationToken }),
  });
}

// ---- login --------------------------------------------------------------------

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().optional(),
});

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

  // FOCA 2.1.3: a user's identity is confirmed through a verified email address
  // before the account can be used.
  if (!user.emailVerified) {
    await logAccountEvent({ userId: user.id, email: user.email ?? "", eventType: "LOGIN_FAILED", ...ipField });
    res.status(403).json({ error: "Please verify your email address before signing in." });
    return;
  }

  // Optional two-factor at sign-in: when the holder has turned it on, the
  // password alone is not enough. The first request (no code) is answered with a
  // challenge; the client then resubmits with the current authenticator code.
  if (user.mfaEnabled && user.mfaRequiredForLogin) {
    const code = parsed.data.code?.trim();
    if (!code) {
      res.status(200).json({ mfaRequired: true });
      return;
    }
    if (!user.mfaSecretWrapped || !verifyTotp(code, unwrapPrivateKey(user.mfaSecretWrapped, getSigningMasterKey()))) {
      await logAccountEvent({ userId: user.id, email: user.email ?? "", eventType: "LOGIN_FAILED", ...ipField });
      res.status(401).json({ error: "That second-factor code did not match." });
      return;
    }
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

// ---- resend-verification ------------------------------------------------------

const ResendBody = z.object({ email: z.string().email() });

async function resendVerification(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = ResendBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }
  // Reissue a token and email it, but only for an account that exists and is not
  // yet verified. The response is the same either way so the endpoint cannot be
  // used to discover which addresses have accounts.
  const user = await getUserByEmail(parsed.data.email);
  if (user && !user.emailVerified) {
    const token = randomBytes(24).toString("base64url");
    await setEmailVerificationToken(user.id, token);
    await sendVerificationEmail({ to: parsed.data.email, name: user.name, link: verificationLink(req, token) });
  }
  res.status(200).json({ ok: true });
}

// ---- password reset -----------------------------------------------------------

const ResetRequestBody = z.object({ email: z.string().email() });

async function requestPasswordReset(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = ResetRequestBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required." });
    return;
  }
  // Issue a single-use token only for an existing account, but answer the same
  // way regardless so the endpoint cannot reveal which addresses have accounts.
  const user = await getUserByEmail(parsed.data.email);
  if (user) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString(); // one hour
    await setPasswordResetToken(user.id, hashToken(token), expiresAt);
    const link = `${origin(req)}/reset?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail({ to: parsed.data.email, name: user.name, link });
    const ip = clientIp(req);
    await logAccountEvent({ userId: user.id, email: user.email ?? "", eventType: "PASSWORD_RESET_REQUEST", ...(ip !== undefined ? { ip } : {}) });
  }
  res.status(200).json({ ok: true });
}

const ResetBody = z.object({ token: z.string().min(1), password: z.string().min(12) });

async function resetPassword(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  const parsed = ResetBody.safeParse(body(req));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A token and a password of at least 12 characters are required." });
    return;
  }
  const ok = await consumePasswordReset(hashToken(parsed.data.token), await hashPassword(parsed.data.password));
  if (!ok) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
    return;
  }
  res.status(200).json({ ok: true });
}
