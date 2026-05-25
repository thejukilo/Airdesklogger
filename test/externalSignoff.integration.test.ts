/**
 * Integration test for the one-time-link (account-less) sign-off flow.
 * Skipped unless a database connection is configured.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import { createUser } from "../src/db/authRepository.js";
import {
  createEntry,
  createSignoffRequest,
  getSignoffRequestByToken,
  signEntryExternal,
  getEntryMeta,
  getEntrySignatures,
  getLedger,
} from "../src/db/repository.js";
import { provisionSigningKeypair } from "../src/auth/signingKeys.js";
import { hashPassword } from "../src/auth/passwords.js";
import { validateEntry } from "../src/domain/validation.js";
import { verifyChain } from "../src/domain/hashChain.js";
import type { FlightEntryInput } from "../src/domain/types.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const MASTER = "0".repeat(64);
const uniq = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!hasDb)("external one-time-link sign-off (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("signs and locks an entry through a single-use link, and refuses reuse", async () => {
    const keys = provisionSigningKeypair(MASTER);
    const holder = await createUser({
      email: `ext-${uniq()}@example.com`,
      passwordHash: await hashPassword("a-strong-password-1"),
      name: "Holder",
      roles: ["PILOT"],
      signingPublicKey: keys.publicKey,
      signingKeyWrapped: keys.wrappedPrivateKey,
    });

    const input: FlightEntryInput = {
      pilotId: holder.id,
      aircraft: { makeModelVariant: "PA-28", registration: "G-EXT", engineClass: "SE", multiPilot: false },
      legs: [
        {
          departurePlace: "EGKB",
          departureTime: new Date("2026-05-25T13:00:00Z"),
          arrivalPlace: "EGKB",
          arrivalTime: new Date("2026-05-25T14:00:00Z"),
        },
      ],
      picName: "SELF (SPIC)",
      landings: { day: 1, night: 0 },
      conditions: { night: 0, ifr: 0 },
      function: { primary: "SPIC", instructor: 0 },
      remarks: "skill test",
    };
    const created = await createEntry(input, validateEntry(input).derived!, holder.id);

    const { token } = await createSignoffRequest({
      entryId: created.entryId,
      signerName: "External Examiner",
      signerEmail: "examiner@example.com",
      capacity: "EXAMINER",
      createdBy: holder.id,
    });

    const resolved = await getSignoffRequestByToken(token);
    expect(resolved?.entryId).toBe(created.entryId);
    expect(resolved?.capacity).toBe("EXAMINER");

    await signEntryExternal(token, {
      signerName: "Sam Examiner",
      signerLicense: "FE-2024",
      signatureImage: "data:image/png;base64,iVBORw0KGgo=",
    });

    expect((await getEntryMeta(created.entryId))?.locked).toBe(true);
    const sigs = await getEntrySignatures(created.entryId);
    expect(sigs.length).toBe(1);
    expect(sigs[0]!.signerName).toBe("Sam Examiner");
    expect(sigs[0]!.signerRole).toBe("EXAMINER");
    expect(sigs[0]!.signerLicense).toBe("FE-2024");
    expect(sigs[0]!.signatureImage).toContain("data:image/png");

    // The token is single-use and the entry is now locked.
    await expect(signEntryExternal(token, { signerName: "Someone Else" })).rejects.toThrow();
    expect(await getSignoffRequestByToken(token)).toBeNull();

    expect(verifyChain(await getLedger()).valid).toBe(true);
  });
});
