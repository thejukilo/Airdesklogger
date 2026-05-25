/**
 * Persistence for accounts, multi-factor secrets and the security log.
 *
 * The flight repository (repository.ts) deals with logbook entries; this module
 * deals with who is allowed to write them. The two share the pilots table: an
 * account and a logbook holder are the same row.
 */

import { getPool } from "./pool.js";
import type { Role } from "../auth/roles.js";

export interface UserRow {
  id: string;
  email: string | null;
  name: string;
  licenseNumber: string | null;
  address: string | null;
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
    licenseNumber: (r.license_number as string) ?? null,
    address: (r.address as string) ?? null,
    roles: (r.roles as Role[]) ?? [],
    passwordHash: (r.password_hash as string) ?? null,
    mfaSecretWrapped: (r.mfa_secret_wrapped as string) ?? null,
    mfaEnabled: Boolean(r.mfa_enabled),
    signingPublicKey: (r.signing_public_key as string) ?? null,
    signingKeyWrapped: (r.signing_key_wrapped as string) ?? null,
  };
}

const USER_COLUMNS =
  "id, email, name, license_number, address, roles, password_hash, mfa_secret_wrapped, mfa_enabled, signing_public_key, signing_key_wrapped";

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string;
  roles: Role[];
  licenseNumber?: string;
  address?: string;
  signingPublicKey: string;
  signingKeyWrapped: string;
}

export async function createUser(u: NewUser): Promise<UserRow> {
  const { rows } = await getPool().query(
    `INSERT INTO pilots (email, password_hash, name, roles, license_number, address, signing_public_key, signing_key_wrapped)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${USER_COLUMNS}`,
    [
      u.email.toLowerCase(),
      u.passwordHash,
      u.name,
      u.roles,
      u.licenseNumber ?? null,
      u.address ?? null,
      u.signingPublicKey,
      u.signingKeyWrapped,
    ],
  );
  return mapUser(rows[0]);
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
