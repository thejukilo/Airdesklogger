import { describe, it, expect } from "vitest";
import {
  generateSigningKeyPair,
  createSignature,
  verifySignature,
  type SigningPayload,
} from "../src/domain/signature.js";
import { hashContent } from "../src/domain/hashChain.js";

const payload = (over: Partial<SigningPayload> = {}): SigningPayload => ({
  entryId: "e1",
  contentHash: hashContent({ total: 90, picName: "Student A" }),
  signerId: "instr1",
  signerRole: "INSTRUCTOR",
  signedAt: "2026-05-25T16:00:00Z",
  ...over,
});

describe("Ed25519 sign-off", () => {
  it("verifies a genuine signature", () => {
    const keys = generateSigningKeyPair();
    const sig = createSignature(keys, payload());
    expect(verifySignature(sig)).toBe(true);
  });

  it("rejects a signature whose attested content hash was altered", () => {
    const keys = generateSigningKeyPair();
    const sig = createSignature(keys, payload());
    const tampered = { ...sig, contentHash: hashContent({ total: 999 }) };
    expect(verifySignature(tampered)).toBe(false);
  });

  it("rejects a signature whose signer/role was altered", () => {
    const keys = generateSigningKeyPair();
    const sig = createSignature(keys, payload());
    expect(verifySignature({ ...sig, signerRole: "EXAMINER" })).toBe(false);
    expect(verifySignature({ ...sig, signerId: "someone-else" })).toBe(false);
  });

  it("rejects a signature checked against a different public key", () => {
    const keys = generateSigningKeyPair();
    const other = generateSigningKeyPair();
    const sig = createSignature(keys, payload());
    expect(verifySignature({ ...sig, publicKey: other.publicKey })).toBe(false);
  });
});
