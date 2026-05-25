/**
 * Integration test for the account + sign-off flow against a real PostgreSQL.
 * Skipped unless a connection is configured (DATABASE_URL or PGHOST).
 *   PGHOST=/tmp PGUSER=postgres PGDATABASE=airdesklogger npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setMfaSecret,
  activateMfa,
} from "../src/db/authRepository.js";
import {
  createEntry,
  signCurrentVersion,
  getEntryMeta,
  getLedger,
} from "../src/db/repository.js";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { provisionSigningKeypair, unwrapPrivateKey, wrapPrivateKey } from "../src/auth/signingKeys.js";
import { generateTotpSecret, totp, verifyTotp } from "../src/auth/totp.js";
import { validateEntry } from "../src/domain/validation.js";
import { signEntry, verifySignature } from "../src/domain/signature.js";
import { verifyChain } from "../src/domain/hashChain.js";
import type { FlightEntryInput } from "../src/domain/types.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const MASTER = "0".repeat(64);
const uniq = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!hasDb)("account and sign-off flow (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("registers a holder, stores an Argon2 hash, and verifies the password", async () => {
    const email = `pilot-${uniq()}@example.com`;
    const keys = provisionSigningKeypair(MASTER);
    const hash = await hashPassword("a-strong-password-123");
    await createUser({
      email,
      passwordHash: hash,
      name: "Holder",
      roles: ["PILOT"],
      signingPublicKey: keys.publicKey,
      signingKeyWrapped: keys.wrappedPrivateKey,
    });

    const fetched = await getUserByEmail(email);
    expect(fetched?.passwordHash).toBeTruthy();
    expect(await verifyPassword("a-strong-password-123", fetched!.passwordHash!)).toBe(true);
    expect(await verifyPassword("wrong", fetched!.passwordHash!)).toBe(false);
  });

  it("enables MFA for an instructor and validates a generated code", async () => {
    const keys = provisionSigningKeypair(MASTER);
    const instr = await createUser({
      email: `instr-${uniq()}@example.com`,
      passwordHash: await hashPassword("instructor-password-1"),
      name: "Instructor",
      roles: ["INSTRUCTOR"],
      signingPublicKey: keys.publicKey,
      signingKeyWrapped: keys.wrappedPrivateKey,
    });

    const secret = generateTotpSecret();
    await setMfaSecret(instr.id, wrapPrivateKey(secret, MASTER));
    await activateMfa(instr.id);

    const fresh = await getUserById(instr.id);
    expect(fresh?.mfaEnabled).toBe(true);
    const stored = unwrapPrivateKey(fresh!.mfaSecretWrapped!, MASTER);
    expect(verifyTotp(totp(stored), stored)).toBe(true);
  });

  it("an instructor signs a student's SPIC entry, locking it, after a valid step-up", async () => {
    const studentKeys = provisionSigningKeypair(MASTER);
    const student = await createUser({
      email: `student-${uniq()}@example.com`,
      passwordHash: await hashPassword("student-password-12"),
      name: "Student",
      roles: ["PILOT"],
      signingPublicKey: studentKeys.publicKey,
      signingKeyWrapped: studentKeys.wrappedPrivateKey,
    });

    const instrKeys = provisionSigningKeypair(MASTER);
    const instructor = await createUser({
      email: `fi-${uniq()}@example.com`,
      passwordHash: await hashPassword("instructor-password-2"),
      name: "Flight Instructor",
      roles: ["INSTRUCTOR"],
      signingPublicKey: instrKeys.publicKey,
      signingKeyWrapped: instrKeys.wrappedPrivateKey,
    });
    const mfaSecret = generateTotpSecret();
    await setMfaSecret(instructor.id, wrapPrivateKey(mfaSecret, MASTER));
    await activateMfa(instructor.id);

    const input: FlightEntryInput = {
      pilotId: student.id,
      aircraft: { makeModelVariant: "Piper PA-28", registration: "G-WXYZ", engineClass: "SE", multiPilot: false },
      legs: [
        {
          departurePlace: "EGKB",
          departureTime: new Date("2026-05-25T13:00:00Z"),
          arrivalPlace: "EGKB",
          arrivalTime: new Date("2026-05-25T14:10:00Z"),
        },
      ],
      picName: "SELF (SPIC)",
      landings: { day: 1, night: 0 },
      conditions: { night: 0, ifr: 25 },
      function: { primary: "SPIC", instructor: 0 },
      remarks: "SPIC skill test",
    };
    const created = await createEntry(input, validateEntry(input).derived!, student.id);

    // Step-up: the instructor presents a current code, then signs with their key.
    const fresh = await getUserById(instructor.id);
    const storedSecret = unwrapPrivateKey(fresh!.mfaSecretWrapped!, MASTER);
    expect(verifyTotp(totp(storedSecret), storedSecret)).toBe(true);

    const keys = {
      privateKey: unwrapPrivateKey(fresh!.signingKeyWrapped!, MASTER),
      publicKey: fresh!.signingPublicKey!,
    };
    const sig = await signCurrentVersion(
      created.entryId,
      keys,
      { signerId: instructor.id, signerRole: "INSTRUCTOR" },
      signEntry,
    );

    expect(verifySignature(sig)).toBe(true);
    expect(sig.signerId).toBe(instructor.id);
    expect((await getEntryMeta(created.entryId))?.locked).toBe(true);
    expect(verifyChain(await getLedger()).valid).toBe(true);
  });
});
