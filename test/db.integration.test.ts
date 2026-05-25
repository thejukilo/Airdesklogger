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

  it("locks an entry on sign-off and forbids further amendment", async () => {
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

    const cur = await getCurrentVersion(created.entryId);
    expect(cur.locked).toBe(true);

    await expect(
      amendEntry(created.entryId, input, validateEntry(input).derived!, pilot, "late edit"),
    ).rejects.toThrow(/locked/i);
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

  it("keeps the global ledger chain valid across all operations", async () => {
    const ledger = await getLedger();
    expect(ledger.length).toBeGreaterThan(0);
    expect(verifyChain(ledger).valid).toBe(true);
  });
});
