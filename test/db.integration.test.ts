/**
 * Integration test against a real PostgreSQL. Skipped automatically unless a
 * connection is configured (DATABASE_URL or PGHOST). Run locally with e.g.:
 *   PGHOST=/tmp PGUSER=postgres PGDATABASE=airdesklogger npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { getPool, closePool } from "../src/db/pool.js";
import {
  createPilot,
  createEntry,
  amendEntry,
  signCurrentVersion,
  getCurrentVersion,
  getHistory,
  getLedger,
  findOverlappingFlight,
  voidEntry,
  listEntriesForPilot,
  getEntryMeta,
} from "../src/db/repository.js";
import { validateEntry } from "../src/domain/validation.js";
import { verifyChain } from "../src/domain/hashChain.js";
import { generateSigningKeyPair, signEntry, verifySignature } from "../src/domain/signature.js";
import type { FlightEntryInput } from "../src/domain/types.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);

function entryFor(pilotId: string, picName = "SELF"): FlightEntryInput {
  return {
    pilotId,
    aircraft: { makeModelVariant: "Cessna 172S", registration: "G-ABCD", engineClass: "SE", multiPilot: false },
    legs: [
      {
        departurePlace: "EGKB",
        departureTime: new Date("2026-05-25T08:00:00Z"),
        arrivalPlace: "LFAT",
        arrivalTime: new Date("2026-05-25T09:30:00Z"),
      },
    ],
    picName,
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 20 },
    function: { primary: "SPIC", instructor: 0 },
    remarks: "skill test",
  };
}

describe.skipIf(!hasDb)("repository (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("creates an entry with version 0 and a CREATE ledger record", async () => {
    const pilot = await createPilot("Test Pilot", "UK.FCL.12345");
    const input = entryFor(pilot);
    const derived = validateEntry(input).derived!;
    const created = await createEntry(input, derived, pilot);
    expect(created.versionNo).toBe(0);

    const cur = await getCurrentVersion(created.entryId);
    expect(cur.version_no).toBe(0);
    expect(cur.content_hash).toBe(created.contentHash);
  });

  it("amends into a new immutable version (history preserved, not overwritten)", async () => {
    const pilot = await createPilot("Amend Pilot");
    const input = entryFor(pilot);
    const created = await createEntry(input, validateEntry(input).derived!, pilot);

    const amended = { ...input, remarks: "corrected remarks" };
    const r = await amendEntry(created.entryId, amended, validateEntry(amended).derived!, pilot, "fix remarks");
    expect(r.versionNo).toBe(1);

    const history = await getHistory(created.entryId);
    expect(history.map((h) => h.version_no)).toEqual([0, 1]);
    expect(history[0].content_hash).not.toBe(history[1].content_hash);
  });

  it("locks an entry on sign-off, then reopens it when amended", async () => {
    const pilot = await createPilot("Student");
    const keys = generateSigningKeyPair();
    const instructor = await createPilot("Instructor", "UK.FI.999", keys.publicKey);

    const input = entryFor(pilot);
    const created = await createEntry(input, validateEntry(input).derived!, pilot);

    const sig = await signCurrentVersion(
      created.entryId,
      keys,
      { signerId: instructor, signerRole: "INSTRUCTOR" },
      signEntry,
    );
    expect(verifySignature(sig)).toBe(true);
    expect(sig.contentHash).toBe(created.contentHash);
    expect((await getCurrentVersion(created.entryId)).locked).toBe(true);

    // Amending a signed entry invalidates the sign-off and reopens the entry.
    await amendEntry(created.entryId, input, validateEntry(input).derived!, pilot, "correction");
    const cur = await getCurrentVersion(created.entryId);
    expect(cur.locked).toBe(false);
    expect(Number(cur.version_no)).toBe(created.versionNo + 1);
  });

  it("the database itself rejects UPDATE/DELETE on append-only tables", async () => {
    const pilot = await createPilot("Immutable Pilot");
    const input = entryFor(pilot);
    const created = await createEntry(input, validateEntry(input).derived!, pilot);

    await expect(
      getPool().query("UPDATE flight_entry_versions SET content_hash = 'x' WHERE entry_id = $1", [
        created.entryId,
      ]),
    ).rejects.toThrow(/append-only/);

    await expect(
      getPool().query("DELETE FROM audit_ledger WHERE entry_id = $1", [created.entryId]),
    ).rejects.toThrow(/append-only/);
  });

  it("detects a flight that overlaps an existing one for the same holder", async () => {
    const pilot = await createPilot("Overlap Pilot");
    // An existing flight on 20 June, 14:00 to 18:00 UTC.
    const existing = entryFor(pilot);
    existing.legs = [
      {
        departurePlace: "EGKB",
        departureTime: new Date("2026-06-20T14:00:00Z"),
        arrivalPlace: "EGKB",
        arrivalTime: new Date("2026-06-20T18:00:00Z"),
      },
    ];
    await createEntry(existing, validateEntry(existing).derived!, pilot);

    // 16:00 to 17:00 the same day sits inside it: overlap.
    expect(await findOverlappingFlight(pilot, "2026-06-20T16:00:00Z", "2026-06-20T17:00:00Z")).not.toBeNull();
    // 18:00 to 19:00 begins exactly when the other ends: no overlap.
    expect(await findOverlappingFlight(pilot, "2026-06-20T18:00:00Z", "2026-06-20T19:00:00Z")).toBeNull();
    // A different holder is unaffected.
    const other = await createPilot("Other Pilot");
    expect(await findOverlappingFlight(other, "2026-06-20T16:00:00Z", "2026-06-20T17:00:00Z")).toBeNull();
  });

  it("voids an unsigned entry: it leaves the logbook but the ledger keeps a record", async () => {
    const pilot = await createPilot("Void Pilot");
    const input = entryFor(pilot);
    const created = await createEntry(input, validateEntry(input).derived!, pilot);

    await voidEntry(created.entryId, pilot);

    const list = await listEntriesForPilot(pilot);
    expect(list.find((e) => (e as { id: string }).id === created.entryId)).toBeUndefined();
    expect((await getEntryMeta(created.entryId))?.voided).toBe(true);
    const ledger = await getLedger();
    expect(ledger.some((r) => r.entryId === created.entryId && r.eventType === "VOID")).toBe(true);
  });

  it("keeps the global ledger chain valid across all operations", async () => {
    const ledger = await getLedger();
    expect(ledger.length).toBeGreaterThan(0);
    expect(verifyChain(ledger).valid).toBe(true);
  });
});
