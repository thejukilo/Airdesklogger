/**
 * Persistence for logbook entries with full audit semantics.
 *
 * Invariants enforced here (in addition to the DB triggers):
 *   - creating or amending an entry appends an immutable version snapshot AND a
 *     chained ledger record in the same transaction;
 *   - amending a locked (signed-off) entry is impossible;
 *   - signing attests the CURRENT version's content hash, records a SIGN ledger
 *     event, and locks the entry against further edits.
 *
 * Ledger appends take a transaction-scoped advisory lock so concurrent writers
 * cannot produce a forked/duplicated sequence.
 */

import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./pool.js";
import type { DerivedColumns, FlightEntryInput, FstdSessionInput } from "../domain/types.js";
import { toUtcIso } from "../domain/time.js";
import {
  appendRecord,
  hashContent,
  type LedgerEventType,
  type LedgerRecord,
} from "../domain/hashChain.js";
import {
  generateSigningKeyPair,
  signEntry as edSignEntry,
  verifySignature,
  type Signature,
  type SignerRole,
  type SigningPayload,
} from "../domain/signature.js";

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const LEDGER_LOCK_KEY = 947_213_001; // arbitrary, stable advisory-lock id

/** Canonical, hashable content for a version (UTC ISO strings, no Date objects). */
export function buildVersionContent(input: FlightEntryInput, derived: DerivedColumns) {
  return {
    pilotId: input.pilotId,
    aircraft: input.aircraft,
    legs: input.legs.map((l) => ({
      departurePlace: l.departurePlace,
      departureTime: toUtcIso(l.departureTime),
      arrivalPlace: l.arrivalPlace,
      arrivalTime: toUtcIso(l.arrivalTime),
      ...(l.departurePlaceName !== undefined ? { departurePlaceName: l.departurePlaceName } : {}),
      ...(l.arrivalPlaceName !== undefined ? { arrivalPlaceName: l.arrivalPlaceName } : {}),
    })),
    picName: input.picName,
    landings: input.landings,
    conditions: input.conditions,
    function: input.function,
    remarks: input.remarks,
    columns: {
      ...derived,
      departureTime: toUtcIso(derived.departureTime),
      arrivalTime: toUtcIso(derived.arrivalTime),
    },
  };
}

async function appendLedger(
  client: PoolClient,
  event: { eventType: LedgerEventType; entryId: string; payloadHash: string; actorId: string },
): Promise<LedgerRecord> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_LOCK_KEY]);
  const { rows } = await client.query(
    "SELECT seq, prev_hash, event_type, entry_id, payload_hash, actor_id, recorded_at, record_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1",
  );
  const prev: LedgerRecord | null = rows[0]
    ? {
        seq: Number(rows[0].seq),
        prevHash: rows[0].prev_hash,
        eventType: rows[0].event_type,
        entryId: rows[0].entry_id,
        payloadHash: rows[0].payload_hash,
        actorId: rows[0].actor_id,
        recordedAt: toUtcIso(rows[0].recorded_at),
        recordHash: rows[0].record_hash,
      }
    : null;

  const record = appendRecord(prev, { ...event, recordedAt: toUtcIso(new Date()) });
  await client.query(
    `INSERT INTO audit_ledger (seq, prev_hash, event_type, entry_id, payload_hash, actor_id, recorded_at, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      record.seq,
      record.prevHash,
      record.eventType,
      record.entryId,
      record.payloadHash,
      record.actorId,
      record.recordedAt,
      record.recordHash,
    ],
  );
  return record;
}

export async function createPilot(name: string, licenseNumber?: string, publicKey?: string): Promise<string> {
  const { rows } = await getPool().query(
    "INSERT INTO pilots (name, license_number, public_key) VALUES ($1,$2,$3) RETURNING id",
    [name, licenseNumber ?? null, publicKey ?? null],
  );
  return rows[0].id as string;
}

export interface CreatedEntry {
  entryId: string;
  versionNo: number;
  contentHash: string;
}

export async function createEntry(
  input: FlightEntryInput,
  derived: DerivedColumns,
  actorId: string,
  reason = "initial entry",
): Promise<CreatedEntry> {
  return withTransaction(async (client) => {
    const content = buildVersionContent(input, derived);
    const contentHash = hashContent(content);

    const { rows } = await client.query(
      "INSERT INTO flight_entries (pilot_id, current_version) VALUES ($1, 0) RETURNING id",
      [input.pilotId],
    );
    const entryId = rows[0].id as string;

    await client.query(
      `INSERT INTO flight_entry_versions (entry_id, version_no, content, content_hash, change_reason, created_by)
       VALUES ($1, 0, $2, $3, $4, $5)`,
      [entryId, content, contentHash, reason, actorId],
    );

    await appendLedger(client, { eventType: "CREATE", entryId, payloadHash: contentHash, actorId });
    return { entryId, versionNo: 0, contentHash };
  });
}

/** Canonical, hashable content for an FSTD session row. */
export function buildFstdContent(input: FstdSessionInput, derived: DerivedColumns) {
  return {
    kind: "FSTD" as const,
    pilotId: input.pilotId,
    deviceType: input.deviceType,
    qualificationNumber: input.qualificationNumber,
    instruction: input.instruction,
    date: toUtcIso(input.date),
    totalMinutes: input.totalMinutes,
    remarks: input.remarks,
    columns: { ...derived, departureTime: toUtcIso(derived.departureTime), arrivalTime: toUtcIso(derived.arrivalTime) },
  };
}

/** Record a synthetic training session. Shares the audit trail with flights. */
export async function createFstdEntry(
  input: FstdSessionInput,
  derived: DerivedColumns,
  actorId: string,
  reason = "fstd session",
): Promise<CreatedEntry> {
  return withTransaction(async (client) => {
    const content = buildFstdContent(input, derived);
    const contentHash = hashContent(content);

    const { rows } = await client.query(
      "INSERT INTO flight_entries (pilot_id, current_version) VALUES ($1, 0) RETURNING id",
      [input.pilotId],
    );
    const entryId = rows[0].id as string;

    await client.query(
      `INSERT INTO flight_entry_versions (entry_id, version_no, content, content_hash, change_reason, created_by)
       VALUES ($1, 0, $2, $3, $4, $5)`,
      [entryId, content, contentHash, reason, actorId],
    );

    await appendLedger(client, { eventType: "CREATE", entryId, payloadHash: contentHash, actorId });
    return { entryId, versionNo: 0, contentHash };
  });
}

export async function amendEntry(
  entryId: string,
  input: FlightEntryInput,
  derived: DerivedColumns,
  actorId: string,
  reason: string,
  logged = true,
): Promise<CreatedEntry> {
  return withTransaction(async (client) => {
    const { rows: head } = await client.query(
      "SELECT current_version, locked FROM flight_entries WHERE id = $1 FOR UPDATE",
      [entryId],
    );
    if (head.length === 0) throw new Error(`Entry ${entryId} not found`);

    // Editing a signed entry invalidates the sign-off: the entry is reopened so
    // it can be countersigned again (FOCA 2.4.5). The old signature rows stay for
    // the audit trail but now refer to a superseded version. Unlocking first lets
    // the new version be appended past the lock trigger.
    if (head[0].locked) {
      await client.query("UPDATE flight_entries SET locked = false, locked_at = null WHERE id = $1", [entryId]);
    }

    const versionNo = Number(head[0].current_version) + 1;
    const content = buildVersionContent(input, derived);
    const contentHash = hashContent(content);

    await client.query(
      `INSERT INTO flight_entry_versions (entry_id, version_no, content, content_hash, change_reason, logged, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entryId, versionNo, content, contentHash, logged ? reason : null, logged, actorId],
    );
    await client.query("UPDATE flight_entries SET current_version = $2 WHERE id = $1", [
      entryId,
      versionNo,
    ]);

    await appendLedger(client, { eventType: "MODIFY", entryId, payloadHash: contentHash, actorId });
    return { entryId, versionNo, contentHash };
  });
}

/**
 * Apply a verified sign-off to the entry's current version and lock it. The
 * signature must verify cryptographically and must attest exactly the current
 * version's content hash, otherwise the transaction is rejected.
 */
export async function signCurrentVersion(
  entryId: string,
  keys: { privateKey: string; publicKey: string },
  signer: {
    signerId: string;
    signerRole: Signature["signerRole"];
    signedAt?: string;
    signatureImage?: string;
    signerName?: string;
    signerEmail?: string;
    signerLicense?: string;
    signedPlace?: string;
  },
  signFn: (privateKeyPem: string, payload: SigningPayload) => string,
): Promise<Signature> {
  return withTransaction(async (client) => {
    const { rows: head } = await client.query(
      "SELECT current_version, locked FROM flight_entries WHERE id = $1 FOR UPDATE",
      [entryId],
    );
    if (head.length === 0) throw new Error(`Entry ${entryId} not found`);
    if (head[0].locked) throw new Error(`Entry ${entryId} is already locked`);
    const versionNo = Number(head[0].current_version);

    const { rows: ver } = await client.query(
      "SELECT content_hash FROM flight_entry_versions WHERE entry_id = $1 AND version_no = $2",
      [entryId, versionNo],
    );
    const contentHash = ver[0].content_hash as string;

    const payload: SigningPayload = {
      entryId,
      contentHash,
      signerId: signer.signerId,
      signerRole: signer.signerRole,
      signedAt: signer.signedAt ?? toUtcIso(new Date()),
    };
    const signature: Signature = {
      ...payload,
      signature: signFn(keys.privateKey, payload),
      publicKey: keys.publicKey,
    };
    if (!verifySignature(signature)) throw new Error("Refusing to store an invalid signature");

    await client.query(
      `INSERT INTO signatures (entry_id, version_no, signer_id, signer_role, content_hash, signature, public_key, signed_at, signature_image, signer_name, signer_email, signer_license, signed_place, payload_signer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        entryId,
        versionNo,
        signer.signerId,
        signer.signerRole,
        contentHash,
        signature.signature,
        signature.publicKey,
        payload.signedAt,
        signer.signatureImage ?? null,
        signer.signerName ?? null,
        signer.signerEmail ?? null,
        signer.signerLicense ?? null,
        signer.signedPlace ?? null,
        signer.signerId,
      ],
    );
    await client.query(
      "UPDATE flight_entries SET locked = true, locked_at = $2 WHERE id = $1",
      [entryId, payload.signedAt],
    );

    await appendLedger(client, {
      eventType: "SIGN",
      entryId,
      payloadHash: hashContent(signature),
      actorId: signer.signerId,
    });
    return signature;
  });
}

export async function getCurrentVersion(entryId: string) {
  const { rows } = await getPool().query(
    `SELECT v.version_no, v.content, v.content_hash, e.locked
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
      WHERE e.id = $1`,
    [entryId],
  );
  return rows[0] ?? null;
}

/** Ownership and lock state, without loading the full content. */
export async function getEntryMeta(
  entryId: string,
): Promise<{ pilotId: string; locked: boolean; voided: boolean; currentVersion: number } | null> {
  const { rows } = await getPool().query(
    "SELECT pilot_id, locked, voided, current_version FROM flight_entries WHERE id = $1",
    [entryId],
  );
  if (!rows[0]) return null;
  return {
    pilotId: rows[0].pilot_id as string,
    locked: Boolean(rows[0].locked),
    voided: Boolean(rows[0].voided),
    currentVersion: Number(rows[0].current_version),
  };
}

/**
 * Void (remove from the logbook) an unsigned entry. The row, its versions and the
 * ledger are kept for the audit trail, but the entry no longer appears in the
 * logbook, exports or overlap checks. A signed (locked) entry cannot be voided.
 */
export async function voidEntry(entryId: string, actorId: string, logged = true): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT current_version, voided FROM flight_entries WHERE id = $1 FOR UPDATE",
      [entryId],
    );
    const row = rows[0];
    if (!row) throw new Error("Entry not found.");
    if (row.voided) return;
    const { rows: vrows } = await client.query(
      "SELECT content_hash FROM flight_entry_versions WHERE entry_id = $1 AND version_no = $2",
      [entryId, row.current_version],
    );
    const payloadHash = (vrows[0]?.content_hash as string) ?? "void";
    await client.query(
      "UPDATE flight_entries SET voided = true, voided_at = now(), void_logged = $2 WHERE id = $1",
      [entryId, logged],
    );
    await appendLedger(client, { eventType: "VOID", entryId, payloadHash, actorId });
  });
}

/** Entries belonging to one holder, newest first, with the full content for display. */
export async function listEntriesForPilot(
  pilotId: string,
  opts: { includeVoided?: boolean } = {},
) {
  const { rows } = await getPool().query(
    `SELECT e.id, e.locked, e.voided, e.voided_at, v.content,
            ei.token_id   AS import_token_id,
            ei.imported_at AS import_at,
            it.name        AS import_source
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
       LEFT JOIN entry_imports ei ON ei.entry_id = e.id
       LEFT JOIN import_tokens it ON it.id = ei.token_id
      WHERE e.pilot_id = $1
        AND ($2::boolean OR e.voided = false)
      ORDER BY v.content->'columns'->>'date' DESC, e.created_at DESC`,
    [pilotId, opts.includeVoided ?? false],
  );
  return rows;
}

/**
 * The date of an existing flight whose time window overlaps [startIso, endIso)
 * for this holder, or null when there is none. A pilot cannot be on two flights
 * at once. FSTD sessions carry no flight time and are excluded, as is an entry
 * being amended (excludeEntryId). Endpoints touch: a flight landing exactly when
 * another departs does not overlap.
 */
export async function findOverlappingFlight(
  pilotId: string,
  startIso: string,
  endIso: string,
  excludeEntryId?: string,
): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT v.content->'columns'->>'date' AS date
       FROM flight_entries e
       JOIN flight_entry_versions v ON v.entry_id = e.id AND v.version_no = e.current_version
      WHERE e.pilot_id = $1 AND e.voided = false
        AND ($4::uuid IS NULL OR e.id <> $4::uuid)
        AND COALESCE(v.content->'columns'->>'kind', 'FLIGHT') = 'FLIGHT'
        AND (v.content->'columns'->>'departureTime')::timestamptz < $3::timestamptz
        AND (v.content->'columns'->>'arrivalTime')::timestamptz   > $2::timestamptz
      LIMIT 1`,
    [pilotId, startIso, endIso, excludeEntryId ?? null],
  );
  return rows[0] ? (rows[0].date as string) : null;
}

/** Sign-offs on an entry, with the signer's name, for the entry view. */
export async function getEntrySignatures(entryId: string) {
  const { rows } = await getPool().query(
    `SELECT s.signer_role, s.signed_at, s.signature_image, s.signer_license, s.signed_place,
            COALESCE(s.signer_name, p.name) AS signer_name
       FROM signatures s
       JOIN flight_entries e ON e.id = s.entry_id
       LEFT JOIN pilots p ON p.id = s.signer_id
      WHERE s.entry_id = $1 AND s.version_no = e.current_version
      ORDER BY s.signed_at ASC`,
    [entryId],
  );
  return rows.map((r) => ({
    signerName: (r.signer_name as string) ?? "",
    signerRole: r.signer_role as string,
    signedAt: new Date(r.signed_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    signatureImage: (r.signature_image as string) ?? null,
    signerLicense: (r.signer_license as string) ?? null,
    signedPlace: (r.signed_place as string) ?? null,
  }));
}

export async function getHistory(entryId: string) {
  // Only logged versions are part of the change history; an edit made inside the
  // 48-hour window (logged=false) is not shown (FOCA 2.3.7).
  const { rows } = await getPool().query(
    `SELECT version_no, content_hash, change_reason, created_by, created_at
       FROM flight_entry_versions WHERE entry_id = $1 AND logged = true ORDER BY version_no`,
    [entryId],
  );
  return rows;
}

/** Context the edit/delete rules need: when it was first logged, current total, status. */
export async function getEntryEditContext(
  entryId: string,
): Promise<{ pilotId: string; locked: boolean; voided: boolean; createdAt: string; total: number; kind: string } | null> {
  const { rows } = await getPool().query(
    `SELECT e.pilot_id, e.locked, e.voided,
            (SELECT created_at FROM flight_entry_versions WHERE entry_id = e.id AND version_no = 0) AS created_at,
            (cv.content->'columns'->>'total')::int AS total,
            COALESCE(cv.content->'columns'->>'kind', 'FLIGHT') AS kind
       FROM flight_entries e
       JOIN flight_entry_versions cv ON cv.entry_id = e.id AND cv.version_no = e.current_version
      WHERE e.id = $1`,
    [entryId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    pilotId: r.pilot_id as string,
    locked: Boolean(r.locked),
    voided: Boolean(r.voided),
    createdAt: new Date(r.created_at).toISOString(),
    total: Number(r.total ?? 0),
    kind: String(r.kind),
  };
}

/** Email contacts and capacity of the signers on the current version, to tell them an edit reopened it. */
export async function getEntrySignerContacts(entryId: string): Promise<Array<{ name: string; email: string; role: string }>> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(s.signer_email, p.email) AS email, COALESCE(s.signer_name, p.name) AS name, s.signer_role AS role
       FROM signatures s
       JOIN flight_entries e ON e.id = s.entry_id
       LEFT JOIN pilots p ON p.id = s.signer_id
      WHERE s.entry_id = $1 AND s.version_no = e.current_version`,
    [entryId],
  );
  return rows
    .filter((r) => r.email)
    .map((r) => ({ name: (r.name as string) ?? "", email: r.email as string, role: r.role as string }));
}

export async function getLedger(): Promise<LedgerRecord[]> {
  const { rows } = await getPool().query(
    "SELECT seq, prev_hash, event_type, entry_id, payload_hash, actor_id, recorded_at, record_hash FROM audit_ledger ORDER BY seq",
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    prevHash: r.prev_hash,
    eventType: r.event_type,
    entryId: r.entry_id,
    payloadHash: r.payload_hash,
    actorId: r.actor_id,
    recordedAt: toUtcIso(r.recorded_at),
    recordHash: r.record_hash,
  }));
}

// ---- One-time sign-off links for external signers -----------------------------

export interface SignoffRequest {
  id: string;
  entryIds: string[];
  signerName: string;
  signerEmail: string;
  capacity: SignerRole;
}

/**
 * Create a single-use signing link covering one or more entries. The signer
 * countersigns them all with one signature at the public link. Returns the raw
 * token (only stored hashed).
 */
export async function createSignoffRequest(input: {
  entryIds: string[];
  signerName: string;
  signerEmail: string;
  capacity: SignerRole;
  createdBy: string;
  ttlHours?: number;
}): Promise<{ token: string; expiresAt: string }> {
  if (input.entryIds.length === 0) throw new Error("At least one entry is required.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? 72) * 3_600_000).toISOString();
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO signoff_requests (entry_id, token_hash, signer_name, signer_email, capacity, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      // entry_id is kept on the row as the "primary" entry for legacy reads;
      // the authoritative list lives in signoff_request_entries.
      [input.entryIds[0], tokenHash(token), input.signerName, input.signerEmail, input.capacity, input.createdBy, expiresAt],
    );
    const requestId = rows[0].id as string;
    for (const entryId of input.entryIds) {
      await client.query(
        "INSERT INTO signoff_request_entries (request_id, entry_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [requestId, entryId],
      );
    }
  });
  return { token, expiresAt };
}

/** Resolve a still-valid request from its token (for the public signing page). */
export async function getSignoffRequestByToken(token: string): Promise<SignoffRequest | null> {
  const { rows } = await getPool().query(
    `SELECT id, entry_id, signer_name, signer_email, capacity
       FROM signoff_requests
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash(token)],
  );
  if (!rows[0]) return null;
  const { rows: linked } = await getPool().query(
    "SELECT entry_id FROM signoff_request_entries WHERE request_id = $1",
    [rows[0].id],
  );
  const entryIds = linked.length > 0 ? linked.map((r) => r.entry_id as string) : [rows[0].entry_id as string];
  return {
    id: rows[0].id,
    entryIds,
    signerName: rows[0].signer_name,
    signerEmail: rows[0].signer_email,
    capacity: rows[0].capacity,
  };
}

/**
 * Sign every entry covered by a one-time link. The external signer has no
 * account, so a throwaway key pair signs each content hash and the signature
 * row stores who signed (name, email from the request, optional licence and
 * place). Consuming the token, locking every entry and writing the ledger
 * records happen atomically: if any one entry is already locked the whole
 * batch is rejected.
 */
export async function signEntriesExternal(
  token: string,
  signer: { signerName: string; signerLicense?: string; signatureImage?: string; signedPlace?: string },
): Promise<{ entryIds: string[] }> {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      "SELECT id, signer_email, capacity, created_by FROM signoff_requests WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
      [tokenHash(token)],
    );
    if (reqRows.length === 0) throw new Error("This signing link is invalid, already used, or expired.");
    const reqId = reqRows[0].id as string;
    const capacity = reqRows[0].capacity as SignerRole;
    const createdBy = reqRows[0].created_by as string;
    const signerEmail = reqRows[0].signer_email as string;

    const { rows: linked } = await client.query(
      "SELECT entry_id FROM signoff_request_entries WHERE request_id = $1",
      [reqId],
    );
    const entryIds = linked.length > 0
      ? linked.map((r) => r.entry_id as string)
      : [(reqRows[0] as { entry_id?: string }).entry_id ?? ""].filter(Boolean);
    if (entryIds.length === 0) throw new Error("Request has no entries.");

    // Same instant for every entry in the batch, so the audit reads as one act.
    const signedAt = toUtcIso(new Date());
    for (const entryId of entryIds) {
      const { rows: head } = await client.query(
        "SELECT current_version, locked FROM flight_entries WHERE id = $1 FOR UPDATE",
        [entryId],
      );
      if (head.length === 0) throw new Error(`Entry ${entryId} not found.`);
      if (head[0].locked) throw new Error("One of the entries is already locked.");
      const versionNo = Number(head[0].current_version);

      const { rows: ver } = await client.query(
        "SELECT content_hash FROM flight_entry_versions WHERE entry_id = $1 AND version_no = $2",
        [entryId, versionNo],
      );
      const contentHash = ver[0].content_hash as string;

      const keys = generateSigningKeyPair();
      const payload: SigningPayload = {
        entryId,
        contentHash,
        signerId: `link:${reqId}`,
        signerRole: capacity,
        signedAt,
      };
      const signature: Signature = {
        ...payload,
        signature: edSignEntry(keys.privateKey, payload),
        publicKey: keys.publicKey,
      };
      if (!verifySignature(signature)) throw new Error("Refusing to store an invalid signature");

      await client.query(
        `INSERT INTO signatures (entry_id, version_no, signer_id, signer_role, content_hash, signature, public_key, signed_at, signature_image, signer_name, signer_email, signer_license, signed_place, payload_signer_id)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          entryId,
          versionNo,
          capacity,
          contentHash,
          signature.signature,
          signature.publicKey,
          payload.signedAt,
          signer.signatureImage ?? null,
          signer.signerName,
          signerEmail,
          signer.signerLicense ?? null,
          signer.signedPlace ?? null,
          payload.signerId,
        ],
      );
      await client.query("UPDATE flight_entries SET locked = true, locked_at = $2 WHERE id = $1", [
        entryId,
        signedAt,
      ]);
      await appendLedger(client, {
        eventType: "SIGN",
        entryId,
        payloadHash: hashContent(signature),
        actorId: createdBy,
      });
    }
    await client.query("UPDATE signoff_requests SET used_at = now() WHERE id = $1", [reqId]);
    return { entryIds };
  });
}
