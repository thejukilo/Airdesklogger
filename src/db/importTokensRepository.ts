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

export type SourceTimeZone = "UTC" | "LOCAL";
export type StoreTimeZone = "UTC" | "LOCAL";
export type TmgCategoryFiling = "AEROPLANE" | "SAILPLANE";

export interface ImportTokenPrefs {
  sourceTimeZone: SourceTimeZone;
  storeTimeZone: StoreTimeZone;
  tmgCategory: TmgCategoryFiling;
}

export interface ImportTokenRow extends ImportTokenPrefs {
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

const COLUMNS =
  "id, user_id, name, token_prefix, scope, last_used_at, revoked_at, created_at, " +
  "source_time_zone, store_time_zone, tmg_category";

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
    sourceTimeZone: r.source_time_zone as SourceTimeZone,
    storeTimeZone: r.store_time_zone as StoreTimeZone,
    tmgCategory: r.tmg_category as TmgCategoryFiling,
  };
}

export async function createImportToken(
  userId: string,
  name: string,
  prefs: ImportTokenPrefs,
): Promise<CreatedImportToken> {
  const raw = randomBytes(RAW_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${raw}`;
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, PREFIX_DISPLAY_LEN);
  const { rows } = await getPool().query(
    `INSERT INTO import_tokens
       (user_id, name, token_hash, token_prefix,
        source_time_zone, store_time_zone, tmg_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
    [userId, name, tokenHash, tokenPrefix, prefs.sourceTimeZone, prefs.storeTimeZone, prefs.tmgCategory],
  );
  return { row: rowFromDb(rows[0]), token };
}

export async function listImportTokens(userId: string): Promise<ImportTokenRow[]> {
  const { rows } = await getPool().query(
    `SELECT ${COLUMNS}
       FROM import_tokens
      WHERE user_id = $1
      ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    [userId],
  );
  return rows.map(rowFromDb);
}

/**
 * Edit the per-token preferences (time-zone source/store, TMG filing) without
 * rotating the secret. Returns the updated row, or null if the token does not
 * belong to the user or has been revoked.
 */
export async function updateImportTokenPrefs(
  userId: string,
  tokenId: string,
  prefs: Partial<ImportTokenPrefs> & { name?: string },
): Promise<ImportTokenRow | null> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (prefs.name !== undefined)           { args.push(prefs.name);           sets.push(`name = $${args.length}`); }
  if (prefs.sourceTimeZone !== undefined) { args.push(prefs.sourceTimeZone); sets.push(`source_time_zone = $${args.length}`); }
  if (prefs.storeTimeZone !== undefined)  { args.push(prefs.storeTimeZone);  sets.push(`store_time_zone = $${args.length}`); }
  if (prefs.tmgCategory !== undefined)    { args.push(prefs.tmgCategory);    sets.push(`tmg_category = $${args.length}`); }
  if (sets.length === 0) return null;
  args.push(tokenId, userId);
  const { rows } = await getPool().query(
    `UPDATE import_tokens SET ${sets.join(", ")}
       WHERE id = $${args.length - 1} AND user_id = $${args.length} AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
    args,
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function revokeImportToken(userId: string, tokenId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE import_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export interface ActiveImportToken extends ImportTokenPrefs {
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
    `SELECT id, user_id, name, scope, token_hash, revoked_at,
            source_time_zone, store_time_zone, tmg_category
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
    sourceTimeZone: r.source_time_zone as SourceTimeZone,
    storeTimeZone: r.store_time_zone as StoreTimeZone,
    tmgCategory: r.tmg_category as TmgCategoryFiling,
  };
}

export async function touchTokenUse(tokenId: string): Promise<void> {
  await getPool().query("UPDATE import_tokens SET last_used_at = now() WHERE id = $1", [tokenId]);
}

export interface ExistingImport {
  entryId: string;
  importedAt: string;
  /** True when the entry this import points to has been voided by the holder. */
  entryVoided: boolean;
}

export async function findImportByExternalId(
  tokenId: string,
  externalId: string,
): Promise<ExistingImport | null> {
  const { rows } = await getPool().query(
    `SELECT ei.entry_id, ei.imported_at, fe.voided
       FROM entry_imports ei
       JOIN flight_entries fe ON fe.id = ei.entry_id
      WHERE ei.token_id = $1 AND ei.external_id = $2`,
    [tokenId, externalId],
  );
  if (!rows[0]) return null;
  return {
    entryId: rows[0].entry_id as string,
    importedAt: new Date(rows[0].imported_at as string).toISOString(),
    entryVoided: Boolean(rows[0].voided),
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

/**
 * Redirect an existing (token, externalId) mapping to a newly-created entry.
 * Used when the holder has voided the previously-imported entry and the
 * external system re-pushes the corrected flight — the new entry stands on
 * its own audit chain, while the voided entry remains in the ledger.
 *
 * entry_imports rows are immutable except for this redirect path, which the
 * forbid_mutation trigger explicitly allows (see schema.sql).
 */
export async function replaceImportTarget(
  tokenId: string,
  externalId: string,
  newEntryId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE entry_imports
        SET entry_id = $3, imported_at = now()
      WHERE token_id = $1 AND external_id = $2`,
    [tokenId, externalId, newEntryId],
  );
}
