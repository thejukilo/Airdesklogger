/**
 * Per-pilot personal access tokens used by the Import API. A pilot creates a
 * named token from the account page, hands it to their flight-school system,
 * and that system can then append flights to this logbook (and only append).
 *
 * The raw token is shown to the pilot once at issue time and is never persisted.
 * Storage holds only the SHA-256 of the full token string plus a short prefix
 * for recognition. Lookup is O(1) by hash, which is safe because the secret is
 * 256 bits of CSPRNG output — there is nothing to brute-force, so the slow KDF
 * we use for passwords would buy nothing here and add ~100ms to every import.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getPool } from "./pool.js";

const TOKEN_PREFIX = "airdesk_pat_";
const RAW_BYTES = 32; // 256-bit secret, base64url encoded
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 8;

export interface ImportTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedImportToken {
  row: ImportTokenRow;
  /** The full secret to display once to the holder; not stored anywhere. */
  token: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function rowFromDb(r: Record<string, unknown>): ImportTokenRow {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    name: r.name as string,
    tokenPrefix: r.token_prefix as string,
    scope: r.scope as string,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function createImportToken(userId: string, name: string): Promise<CreatedImportToken> {
  const raw = randomBytes(RAW_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${raw}`;
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, PREFIX_DISPLAY_LEN);
  const { rows } = await getPool().query(
    `INSERT INTO import_tokens (user_id, name, token_hash, token_prefix)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, token_prefix, scope, last_used_at, revoked_at, created_at`,
    [userId, name, tokenHash, tokenPrefix],
  );
  return { row: rowFromDb(rows[0]), token };
}

export async function listImportTokens(userId: string): Promise<ImportTokenRow[]> {
  const { rows } = await getPool().query(
    `SELECT id, user_id, name, token_prefix, scope, last_used_at, revoked_at, created_at
       FROM import_tokens
      WHERE user_id = $1
      ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    [userId],
  );
  return rows.map(rowFromDb);
}

export async function revokeImportToken(userId: string, tokenId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE import_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export interface ActiveImportToken {
  id: string;
  userId: string;
  name: string;
  scope: string;
}

/**
 * Resolve a raw bearer token to its active row, or null if it does not match,
 * has been revoked, or is malformed. Hash comparison is timing-safe even though
 * the lookup itself is by indexed hash (defensive — both branches feel the same
 * to a remote observer).
 */
export async function findActiveTokenByRaw(raw: string): Promise<ActiveImportToken | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(raw);
  const { rows } = await getPool().query(
    `SELECT id, user_id, name, scope, token_hash, revoked_at
       FROM import_tokens
      WHERE token_hash = $1`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  // Defensive: hash collision is astronomical, but compare the stored hash to
  // the computed hash with a constant-time compare so this branch is uniform.
  const stored = Buffer.from(r.token_hash as string, "hex");
  const computed = Buffer.from(tokenHash, "hex");
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) return null;
  if (r.revoked_at) return null;
  return {
    id: r.id as string,
    userId: r.user_id as string,
    name: r.name as string,
    scope: r.scope as string,
  };
}

export async function touchTokenUse(tokenId: string): Promise<void> {
  await getPool().query("UPDATE import_tokens SET last_used_at = now() WHERE id = $1", [tokenId]);
}

export interface ExistingImport {
  entryId: string;
  importedAt: string;
}

export async function findImportByExternalId(
  tokenId: string,
  externalId: string,
): Promise<ExistingImport | null> {
  const { rows } = await getPool().query(
    `SELECT entry_id, imported_at
       FROM entry_imports
      WHERE token_id = $1 AND external_id = $2`,
    [tokenId, externalId],
  );
  if (!rows[0]) return null;
  return {
    entryId: rows[0].entry_id as string,
    importedAt: new Date(rows[0].imported_at as string).toISOString(),
  };
}

export async function recordImport(
  tokenId: string,
  externalId: string,
  entryId: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO entry_imports (token_id, external_id, entry_id)
       VALUES ($1, $2, $3)`,
    [tokenId, externalId, entryId],
  );
}
