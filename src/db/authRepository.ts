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
  emailVerified: boolean;
  roles: Role[];
  passwordHash: string | null;
  mfaSecretWrapped: string | null;
  mfaEnabled: boolean;
  signingPublicKey: string | null;
  signingKeyWrapped: string | null;
}

function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id: r.id as string,
    email: (r.email as string) ?? null,
    name: r.name as string,
    firstName: (r.first_name as string) ?? null,
    lastName: (r.last_name as string) ?? null,
    dateOfBirth: r.date_of_birth ? String(r.date_of_birth).slice(0, 10) : null,
    licenseNumber: (r.license_number as string) ?? null,
    address: (r.address as string) ?? null,
    emailVerified: Boolean(r.email_verified),
    roles: (r.roles as Role[]) ?? [],
    passwordHash: (r.password_hash as string) ?? null,
    mfaSecretWrapped: (r.mfa_secret_wrapped as string) ?? null,
    mfaEnabled: Boolean(r.mfa_enabled),
    signingPublicKey: (r.signing_public_key as string) ?? null,
    signingKeyWrapped: (r.signing_key_wrapped as string) ?? null,
  };
}

const USER_COLUMNS =
  "id, email, name, first_name, last_name, date_of_birth, license_number, address, email_verified, roles, password_hash, mfa_secret_wrapped, mfa_enabled, signing_public_key, signing_key_wrapped";

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  roles: Role[];
  licenseNumber?: string;
  address?: string;
  emailVerificationToken?: string;
  signingPublicKey: string;
  signingKeyWrapped: string;
}

export async function createUser(u: NewUser): Promise<UserRow> {
  const verificationToken = u.emailVerificationToken ?? randomBytes(24).toString("base64url");
  const { rows } = await getPool().query(
    `INSERT INTO pilots
       (email, password_hash, name, first_name, last_name, date_of_birth, roles,
        license_number, address, email_verification_token, signing_public_key, signing_key_wrapped)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${USER_COLUMNS}`,
    [
      u.email.toLowerCase(),
      u.passwordHash,
      u.name,
      u.firstName ?? null,
      u.lastName ?? null,
      u.dateOfBirth ?? null,
      u.roles,
      u.licenseNumber ?? null,
      u.address ?? null,
      verificationToken,
      u.signingPublicKey,
      u.signingKeyWrapped,
    ],
  );
  return mapUser(rows[0]);
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
  | "SIGN_STEP_UP_FAILED";

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
