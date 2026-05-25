/**
 * Tamper-evident append-only ledger.
 *
 * Every mutation of a logbook entry (create, modify, sign, void) appends one
 * record to a global ledger. Each record hashes the previous record's hash into
 * its own, forming a chain: altering or removing any past record invalidates
 * every record after it. This is the cryptographic backbone of the EASA
 * immutability requirement: history is proven, not merely "not overwritten".
 */

import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export type LedgerEventType = "CREATE" | "MODIFY" | "SIGN" | "VOID";

export interface LedgerRecordInput {
  seq: number;
  prevHash: string;
  eventType: LedgerEventType;
  entryId: string;
  /** Hash of the entry version / event payload this record attests. */
  payloadHash: string;
  /** UTC ISO instant the record was created. */
  recordedAt: string;
  actorId: string;
}

export interface LedgerRecord extends LedgerRecordInput {
  recordHash: string;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Deterministic JSON: object keys sorted recursively so hashing is stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Hash an arbitrary content object (e.g. a stored entry version). */
export function hashContent(content: unknown): string {
  return sha256Hex(canonicalJson(content));
}

/** Compute the chained record hash for a ledger record. */
export function computeRecordHash(r: LedgerRecordInput): string {
  return sha256Hex(
    canonicalJson({
      seq: r.seq,
      prevHash: r.prevHash,
      eventType: r.eventType,
      entryId: r.entryId,
      payloadHash: r.payloadHash,
      recordedAt: r.recordedAt,
      actorId: r.actorId,
    }),
  );
}

/** Build the next record in the chain from the previous one (or genesis). */
export function appendRecord(
  prev: LedgerRecord | null,
  input: Omit<LedgerRecordInput, "seq" | "prevHash">,
): LedgerRecord {
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.recordHash : GENESIS_HASH;
  const full: LedgerRecordInput = { ...input, seq, prevHash };
  return { ...full, recordHash: computeRecordHash(full) };
}

export interface ChainVerification {
  valid: boolean;
  brokenAtSeq?: number;
  reason?: string;
}

/** Verify a full ledger: sequencing, prev-hash links, and recomputed hashes. */
export function verifyChain(records: readonly LedgerRecord[]): ChainVerification {
  let prev: LedgerRecord | null = null;
  for (const r of records) {
    const expectedSeq = prev ? prev.seq + 1 : 0;
    const expectedPrev = prev ? prev.recordHash : GENESIS_HASH;
    if (r.seq !== expectedSeq) {
      return { valid: false, brokenAtSeq: r.seq, reason: `Expected seq ${expectedSeq}.` };
    }
    if (r.prevHash !== expectedPrev) {
      return { valid: false, brokenAtSeq: r.seq, reason: "prevHash does not match prior record." };
    }
    if (computeRecordHash(r) !== r.recordHash) {
      return { valid: false, brokenAtSeq: r.seq, reason: "recordHash does not match contents." };
    }
    prev = r;
  }
  return { valid: true };
}
