import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  totp,
  verifyTotp,
  generateTotpSecret,
  otpauthUri,
} from "../src/auth/totp.js";

// RFC 6238 reference secret, the ASCII string "12345678901234567890".
const SEED = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP (RFC 6238 vectors)", () => {
  const cases: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];

  it.each(cases)("SHA-1, 8 digits, T=%i", (t, expected) => {
    expect(totp(SEED, t * 1000, { digits: 8, algorithm: "SHA-1" })).toBe(expected);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("TOTP verification", () => {
  it("accepts the current code", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(totp(secret, now), secret, { nowMs: now })).toBe(true);
  });

  it("accepts a code from the adjacent step (clock skew)", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const previous = totp(secret, now - 30_000);
    expect(verifyTotp(previous, secret, { nowMs: now, window: 1 })).toBe(true);
  });

  it("rejects a code outside the window", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const old = totp(secret, now - 120_000);
    expect(verifyTotp(old, secret, { nowMs: now, window: 1 })).toBe(false);
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp("000000", secret)).toBe(false);
  });

  it("builds an otpauth URI carrying the secret and issuer", () => {
    const secret = generateTotpSecret();
    const uri = otpauthUri(secret, "pilot@example.com", "AirdeskLogger");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=AirdeskLogger");
  });
});
