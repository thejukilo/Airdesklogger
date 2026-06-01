/**
 * Persistence for accounts, multi-factor secrets and the security log.
 *
 * The flight repository (repository.ts) deals with logbook entries; this module
 * deals with who is allowed to write them. The two share the pilots table: an
 * account and a logbook holder are the same row.
 */

import { randomBytes } from "node:crypto";
import { getPool } from "./pool.js";
import type { Role } from "../auth/roles.js";

export interface UserRow {
  id: string;
  email: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  licenseNumber: string | null;
  address: string | null;
  addressStreet: string | null;
  addressZip: string | null;
  addressCountry: string | null;
  instructorCertificate: string | null;
  examinerCertificate: string | null;
  exportPaperSize: "A4" | "LETTER";
  emailVerified: boolean;
  roles: Role[];
  passwordHash: string | null;
  mfaSecretWrapped: string | null;
  mfaEnabled: boolean;
  mfaRequiredForLogin: boolean;
  signingPublicKey: string | null;
  signingKeyWrapped: string | null;
  /** Stripe linkage; null until the first checkout opens. */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
}

/** A date column may arrive as a JS Date (node-postgres) or a string; either way return yyyy-mm-dd. */
function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id: r.id as string,
    email: (r.email as string) ?? null,
    name: r.name as string,
    firstName: (r.first_name as string) ?? null,
    lastName: (r.last_name as string) ?? null,
    dateOfBirth: dateOnly(r.date_of_birth),
    licenseNumber: (r.license_number as string) ?? null,
    address: (r.address as string) ?? null,
    addressStreet: (r.address_street as string) ?? null,
    addressZip: (r.address_zip as string) ?? null,
    addressCountry: (r.address_country as string) ?? null,
    instructorCertificate: (r.instructor_certificate as string) ?? null,
    examinerCertificate: (r.examiner_certificate as string) ?? null,
    exportPaperSize: r.export_paper_size === "LETTER" ? "LETTER" : "A4",
    emailVerified: Boolean(r.email_verified),
    roles: (r.roles as Role[]) ?? [],
    passwordHash: (r.password_hash as string) ?? null,
    mfaSecretWrapped: (r.mfa_secret_wrapped as string) ?? null,
    mfaEnabled: Boolean(r.mfa_enabled),
    mfaRequiredForLogin: Boolean(r.mfa_required_for_login),
    signingPublicKey: (r.signing_public_key as string) ?? null,
    signingKeyWrapped: (r.signing_key_wrapped as string) ?? null,
    stripeCustomerId: (r.stripe_customer_id as string) ?? null,
    stripeSubscriptionId: (r.stripe_subscription_id as string) ?? null,
    stripePriceId: (r.stripe_price_id as string) ?? null,
  };
}

const USER_COLUMNS =
  "id, email, name, first_name, last_name, date_of_birth, license_number, address, address_street, address_zip, address_country, instructor_certificate, examiner_certificate, export_paper_size, email_verified, roles, password_hash, mfa_secret_wrapped, mfa_enabled, mfa_required_for_login, signing_public_key, signing_key_wrapped, stripe_customer_id, stripe_subscription_id, stripe_price_id";

/** One-line address composed from its parts, for the export and display. */
function composeAddress(street?: string | null, zip?: string | null, country?: string | null): string | null {
  const parts = [street, zip, country].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  roles: Role[];
  licenseNumber?: string;
  addressStreet?: string;
  addressZip?: string;
  addressCountry?: string;
  emailVerificationToken?: string;
  signingPublicKey: string;
  signingKeyWrapped: string;
}

export async function createUser(u: NewUser): Promise<UserRow> {
  const verificationToken = u.emailVerificationToken ?? randomBytes(24).toString("base64url");
  const address = composeAddress(u.addressStreet, u.addressZip, u.addressCountry);
  // 3-day trial starts now. State is 'trialing' until the cron expires it.
  const TRIAL_DAYS = 3;
  const trialStart = new Date();
  const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await getPool().query(
    `INSERT INTO pilots
       (email, password_hash, name, first_name, last_name, date_of_birth, roles,
        license_number, address, address_street, address_zip, address_country,
        email_verification_token, signing_public_key, signing_key_wrapped,
        subscription_state, trial_started_at, trial_ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'trialing',$16,$17)
     RETURNING ${USER_COLUMNS}`,
    [
      u.email.toLowerCase(),
      u.passwordHash,
      u.name,
      u.firstName ?? null,
      u.lastName ?? null,
      u.dateOfBirth ?? null,
      u.roles,
      u.licenseNumber ?? null,
      address,
      u.addressStreet ?? null,
      u.addressZip ?? null,
      u.addressCountry ?? null,
      verificationToken,
      u.signingPublicKey,
      u.signingKeyWrapped,
      trialStart.toISOString(),
      trialEnd.toISOString(),
    ],
  );
  return mapUser(rows[0]);
}

export interface ProfileUpdate {
  firstName?: string | undefined;
  lastName?: string | undefined;
  dateOfBirth?: string | undefined; // yyyy-mm-dd or empty
  addressStreet?: string | undefined;
  addressZip?: string | undefined;
  addressCountry?: string | undefined;
  licenseNumber?: string | undefined;
  instructorCertificate?: string | undefined;
  examinerCertificate?: string | undefined;
  paperSize?: "A4" | "LETTER" | undefined;
  mfaRequiredForLogin?: boolean | undefined;
}

/**
 * Update a user's profile and recompute the signer roles from the certificates
 * they declare: holding an instructor certificate grants INSTRUCTOR, an examiner
 * certificate grants EXAMINER. Other roles (PILOT, ADMIN, ATO and so on) are left
 * as they are. This is a partial update: only the fields present in the input
 * are written, so saving one setting never clears another. An empty string in a
 * provided field clears that field.
 */
export async function updateProfile(userId: string, p: ProfileUpdate): Promise<UserRow> {
  const blank = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : null);

  // Regulatory: once any flight is logged against the pilot, the identity used
  // to sign that record (forename, surname, date of birth) is frozen so the
  // logbook cannot be re-attributed to a different person. A no-op submission
  // (same value) is allowed; an attempt to change to a new value is rejected.
  const changesIdentity =
    p.firstName !== undefined || p.lastName !== undefined || p.dateOfBirth !== undefined;
  if (changesIdentity) {
    const current = await getUserById(userId);
    const same = (a: string | null | undefined, b: string | undefined) =>
      b === undefined || (blank(b) ?? "") === (a ?? "");
    const identityChanges =
      !same(current?.firstName, p.firstName) ||
      !same(current?.lastName, p.lastName) ||
      !same(current?.dateOfBirth, p.dateOfBirth);
    if (identityChanges && (await pilotHasEntries(userId))) {
      throw new IdentityLockedError();
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [userId];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (p.firstName !== undefined) add("first_name", blank(p.firstName));
  if (p.lastName !== undefined) add("last_name", blank(p.lastName));
  // Keep the single display name (used on the export and header) in step with the
  // forename and surname when both are given.
  const fullName = [blank(p.firstName), blank(p.lastName)].filter(Boolean).join(" ");
  if (p.firstName !== undefined && p.lastName !== undefined && fullName) add("name", fullName);
  if (p.dateOfBirth !== undefined) add("date_of_birth", blank(p.dateOfBirth), "::date");
  // Address parts are edited together; keep the composed one-line address in step.
  if (p.addressStreet !== undefined || p.addressZip !== undefined || p.addressCountry !== undefined) {
    add("address_street", blank(p.addressStreet));
    add("address_zip", blank(p.addressZip));
    add("address_country", blank(p.addressCountry));
    add("address", composeAddress(p.addressStreet, p.addressZip, p.addressCountry));
  }
  if (p.licenseNumber !== undefined) add("license_number", blank(p.licenseNumber));
  if (p.instructorCertificate !== undefined) add("instructor_certificate", blank(p.instructorCertificate));
  if (p.examinerCertificate !== undefined) add("examiner_certificate", blank(p.examinerCertificate));
  if (p.paperSize === "A4" || p.paperSize === "LETTER") add("export_paper_size", p.paperSize);
  if (p.mfaRequiredForLogin !== undefined) add("mfa_required_for_login", p.mfaRequiredForLogin);

  if (sets.length > 0) {
    sets.push("updated_at = now()");
    await getPool().query(`UPDATE pilots SET ${sets.join(", ")} WHERE id = $1`, params);
  }

  const user = (await getUserById(userId))!;
  const kept = user.roles.filter((r) => r !== "INSTRUCTOR" && r !== "EXAMINER");
  const roles = Array.from(
    new Set<Role>([
      "PILOT",
      ...kept,
      ...(user.instructorCertificate ? (["INSTRUCTOR"] as Role[]) : []),
      ...(user.examinerCertificate ? (["EXAMINER"] as Role[]) : []),
    ]),
  );
  await getPool().query("UPDATE pilots SET roles = $2 WHERE id = $1", [userId, roles]);
  return (await getUserById(userId))!;
}

/** Add a role to a user (idempotent), returning the new role set. */
export async function addRole(userId: string, role: Role): Promise<Role[]> {
  const user = await getUserById(userId);
  if (!user) return [];
  const roles = Array.from(new Set<Role>([...user.roles, role]));
  await getPool().query("UPDATE pilots SET roles = $2, updated_at = now() WHERE id = $1", [userId, roles]);
  return roles;
}

/**
 * True once the pilot has any (non-voided) flight entry. Identity fields - first
 * name, last name, date of birth - become read-only at that point so the
 * countersigned record can never be re-attributed to someone else.
 */
export async function pilotHasEntries(userId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    "SELECT 1 FROM flight_entries WHERE pilot_id = $1 AND voided = false LIMIT 1",
    [userId],
  );
  return rows.length > 0;
}

/** Thrown by updateProfile when a caller tries to edit a locked identity field. */
export class IdentityLockedError extends Error {
  constructor() {
    super("Your name and date of birth cannot be changed once flights have been logged.");
    this.name = "IdentityLockedError";
  }
}

/** Counts and on-disk size for the admin dashboard. */
export async function databaseStats(): Promise<{
  databaseSize: string;
  databaseSizeBytes: number;
  entries: number;
  users: number;
  aircraft: number;
  airports: number;
}> {
  const pool = getPool();
  const size = await pool.query(
    "SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty, pg_database_size(current_database())::bigint AS bytes",
  );
  const counts = await pool.query(
    `SELECT
       (SELECT count(*) FROM flight_entries)::int AS entries,
       (SELECT count(*) FROM pilots)::int        AS users,
       (SELECT count(*) FROM aircraft)::int       AS aircraft,
       (SELECT count(*) FROM airports)::int       AS airports`,
  );
  return {
    databaseSize: String(size.rows[0].pretty),
    databaseSizeBytes: Number(size.rows[0].bytes),
    entries: Number(counts.rows[0].entries),
    users: Number(counts.rows[0].users),
    aircraft: Number(counts.rows[0].aircraft),
    airports: Number(counts.rows[0].airports),
  };
}

/** Store a fresh verification token for a user (used when resending the email). */
export async function setEmailVerificationToken(userId: string, token: string): Promise<void> {
  await getPool().query(
    "UPDATE pilots SET email_verification_token = $2, updated_at = now() WHERE id = $1",
    [userId, token],
  );
}

/** Store a hashed, time-limited password reset token for a user. */
export async function setPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: string,
): Promise<void> {
  await getPool().query(
    `UPDATE pilots SET password_reset_token_hash = $2, password_reset_expires_at = $3, updated_at = now()
      WHERE id = $1`,
    [userId, tokenHash, expiresAt],
  );
}

/**
 * Set a new password from a valid (unexpired) reset token, clear the token, and
 * confirm the email address (the link was delivered to and opened from it).
 * Returns true when a matching, unexpired token was consumed.
 */
export async function consumePasswordReset(tokenHash: string, newPasswordHash: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `UPDATE pilots SET password_hash = $2, email_verified = true,
       password_reset_token_hash = null, password_reset_expires_at = null, updated_at = now()
      WHERE password_reset_token_hash = $1 AND password_reset_expires_at > now()
      RETURNING id`,
    [tokenHash, newPasswordHash],
  );
  return rows.length > 0;
}

/** Confirm an email address from its verification token. Returns the user id. */
export async function verifyEmailByToken(token: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `UPDATE pilots SET email_verified = true, email_verification_token = null, updated_at = now()
      WHERE email_verification_token = $1 RETURNING id`,
    [token],
  );
  return rows[0] ? (rows[0].id as string) : null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_COLUMNS} FROM pilots WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query(`SELECT ${USER_COLUMNS} FROM pilots WHERE id = $1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function setMfaSecret(userId: string, wrappedSecret: string): Promise<void> {
  await getPool().query(
    "UPDATE pilots SET mfa_secret_wrapped = $2, mfa_enabled = false, updated_at = now() WHERE id = $1",
    [userId, wrappedSecret],
  );
}

export async function activateMfa(userId: string): Promise<void> {
  await getPool().query(
    "UPDATE pilots SET mfa_enabled = true, mfa_activated_at = now(), updated_at = now() WHERE id = $1",
    [userId],
  );
}

export type AccountEventType =
  | "REGISTER"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "MFA_SETUP"
  | "MFA_ACTIVATED"
  | "SIGN_STEP_UP"
  | "SIGN_STEP_UP_FAILED"
  | "PASSWORD_RESET_REQUEST";

export async function logAccountEvent(e: {
  userId?: string;
  email?: string;
  eventType: AccountEventType;
  detail?: unknown;
  ip?: string;
}): Promise<void> {
  await getPool().query(
    "INSERT INTO account_events (user_id, email, event_type, detail, ip) VALUES ($1,$2,$3,$4,$5)",
    [e.userId ?? null, e.email ?? null, e.eventType, e.detail ?? null, e.ip ?? null],
  );
}
