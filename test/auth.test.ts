import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/passwords.js";
import { signSession, verifySession } from "../src/auth/tokens.js";
import { canEditOwnLogbook, canSignAs } from "../src/auth/roles.js";
import {
  provisionSigningKeypair,
  wrapPrivateKey,
  unwrapPrivateKey,
} from "../src/auth/signingKeys.js";
import { createSignature, verifySignature } from "../src/domain/signature.js";
import { hashContent } from "../src/domain/hashChain.js";

const SECRET = "this-is-a-test-session-secret-of-sufficient-length";
const MASTER = "0".repeat(64); // 32 bytes hex, test only

describe("password hashing (Argon2id)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
  });

  it("refuses a too-short password", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/12 characters/);
  });
});

describe("session tokens (JWT)", () => {
  it("round-trips claims", async () => {
    const token = await signSession({ sub: "u1", roles: ["PILOT"], email: "p@x.com" }, SECRET);
    const claims = await verifySession(token, SECRET);
    expect(claims.sub).toBe("u1");
    expect(claims.roles).toEqual(["PILOT"]);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ sub: "u1", roles: ["PILOT"], email: "p@x.com" }, SECRET);
    await expect(verifySession(token, SECRET + "x")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signSession({ sub: "u1", roles: ["PILOT"], email: "p@x.com" }, SECRET, "0s");
    await expect(verifySession(token, SECRET)).rejects.toThrow();
  });
});

describe("authorisation rules", () => {
  it("lets a pilot edit only their own logbook", () => {
    expect(canEditOwnLogbook("u1", "u1")).toBe(true);
    expect(canEditOwnLogbook("u1", "u2")).toBe(false);
  });

  it("maps signer roles to allowed capacities", () => {
    expect(canSignAs(["EXAMINER"], "EXAMINER")).toBe(true);
    expect(canSignAs(["INSTRUCTOR"], "EXAMINER")).toBe(false);
    expect(canSignAs(["EXAMINER"], "INSTRUCTOR")).toBe(true);
    expect(canSignAs(["PILOT"], "SUPERVISING_PIC")).toBe(true);
    expect(canSignAs(["PILOT"], "INSTRUCTOR")).toBe(false);
  });

  it("maps the organisational signer capacities (FOCA 2.4.1)", () => {
    expect(canSignAs(["ATO"], "ATO")).toBe(true);
    expect(canSignAs(["DTO"], "DTO")).toBe(true);
    expect(canSignAs(["HOT"], "HOT")).toBe(true);
    expect(canSignAs(["AIRPORT"], "AIRPORT")).toBe(true);
    expect(canSignAs(["ADMIN"], "OTHER")).toBe(true);
    expect(canSignAs(["PILOT"], "ATO")).toBe(false);
    expect(canSignAs(["INSTRUCTOR"], "OTHER")).toBe(false);
  });
});

describe("signing key vault", () => {
  it("wraps and unwraps a private key", () => {
    const { publicKey, wrappedPrivateKey } = provisionSigningKeypair(MASTER);
    const privateKey = unwrapPrivateKey(wrappedPrivateKey, MASTER);
    // The recovered key actually signs and verifies against the stored public key.
    const sig = createSignature(
      { privateKey, publicKey },
      {
        entryId: "e1",
        contentHash: hashContent({ x: 1 }),
        signerId: "instr1",
        signerRole: "EXAMINER",
        signedAt: "2026-05-25T16:00:00Z",
      },
    );
    expect(verifySignature(sig)).toBe(true);
  });

  it("fails to unwrap with the wrong master key", () => {
    const { wrappedPrivateKey } = provisionSigningKeypair(MASTER);
    expect(() => unwrapPrivateKey(wrappedPrivateKey, "1".repeat(64))).toThrow();
  });

  it("rejects a tampered wrapped key (GCM auth tag)", () => {
    const wrapped = wrapPrivateKey("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", MASTER);
    const parts = wrapped.split(":");
    const flipped = Buffer.from(parts[3]!, "base64");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64");
    expect(() => unwrapPrivateKey(parts.join(":"), MASTER)).toThrow();
  });
});
