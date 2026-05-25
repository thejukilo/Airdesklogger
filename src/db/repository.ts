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

import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./pool.js";
import type { DerivedColumns, FlightEntryInput } from "../domain/types.js";
import { toUtcIso } from "../domain/time.js";
import {
  appendRecord,
  hashContent,
  type LedgerEventType,
  type LedgerRecord,
} from "../domain/hashChain.js";
import {
  verifySignature,
  type Signature,
  type SigningPayload,
} from "../domain/signature.js";

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

export async function amendEntry(
  entryId: string,
  input: FlightEntryInput,
  derived: DerivedColumns,
  actorId: string,
  reason: string,
): Promise<CreatedEntry> {
  return withTransaction(async (client) => {
    const { rows: head } = await client.query(
      "SELECT current_version, locked FROM flight_entries WHERE id = $1 FOR UPDATE",
      [entryId],
    );
    if (head.length === 0) throw new Error(`Entry ${entryId} not found`);
    if (head[0].locked) throw new Error(`Entry ${entryId} is locked by sign-off; cannot amend`);

    const versionNo = Number(head[0].current_version) + 1;
    const content = buildVersionContent(input, derived);
    const contentHash = hashContent(content);

    await client.query(
      `INSERT INTO flight_entry_versions (entry_id, version_no, content, content_hash, change_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entryId, versionNo, content, contentHash, reason, actorId],
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
  signer: { signerId: string; signerRole: Signature["signerRole"]; signedAt?: string },
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
      `INSERT INTO signatures (entry_id, version_no, signer_id, signer_role, content_hash, signature, public_key, signed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entryId,
        versionNo,
        signer.signerId,
        signer.signerRole,
        contentHash,
        signature.signature,
        signature.publicKey,
        payload.signedAt,
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

export async function getHistory(entryId: string) {
  const { rows } = await getPool().query(
    `SELECT version_no, content_hash, change_reason, created_by, created_at
       FROM flight_entry_versions WHERE entry_id = $1 ORDER BY version_no`,
    [entryId],
  );
  return rows;
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
