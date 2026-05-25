/**
 * Integration test for profile updates and the self-service signer roles.
 * Skipped unless a database connection is configured.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import { createUser, updateProfile } from "../src/db/authRepository.js";
import { provisionSigningKeypair } from "../src/auth/signingKeys.js";
import { hashPassword } from "../src/auth/passwords.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const MASTER = "0".repeat(64);
const uniq = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!hasDb)("profile and self-service roles (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("grants and removes signer roles from declared certificates", async () => {
    const keys = provisionSigningKeypair(MASTER);
    const user = await createUser({
      email: `prof-${uniq()}@example.com`,
      passwordHash: await hashPassword("a-strong-password-1"),
      name: "Profile User",
      roles: ["PILOT"],
      signingPublicKey: keys.publicKey,
      signingKeyWrapped: keys.wrappedPrivateKey,
    });

    const withInstructor = await updateProfile(user.id, {
      firstName: "Ada",
      licenseNumber: "HB.FCL.123",
      instructorCertificate: "FI-4567",
    });
    expect(withInstructor.roles).toContain("INSTRUCTOR");
    expect(withInstructor.roles).not.toContain("EXAMINER");
    expect(withInstructor.instructorCertificate).toBe("FI-4567");

    const withExaminer = await updateProfile(user.id, {
      instructorCertificate: "FI-4567",
      examinerCertificate: "FE-99",
    });
    expect(withExaminer.roles).toEqual(expect.arrayContaining(["PILOT", "INSTRUCTOR", "EXAMINER"]));

    const cleared = await updateProfile(user.id, { instructorCertificate: "", examinerCertificate: "" });
    expect(cleared.roles).not.toContain("INSTRUCTOR");
    expect(cleared.roles).not.toContain("EXAMINER");
    expect(cleared.roles).toContain("PILOT");
  });
});
