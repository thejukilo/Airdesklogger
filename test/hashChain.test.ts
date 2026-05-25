import { describe, it, expect } from "vitest";
import {
  appendRecord,
  verifyChain,
  hashContent,
  canonicalJson,
  GENESIS_HASH,
  type LedgerRecord,
} from "../src/domain/hashChain.js";

function buildChain(): LedgerRecord[] {
  const r0 = appendRecord(null, {
    eventType: "CREATE",
    entryId: "e1",
    payloadHash: hashContent({ total: 90 }),
    recordedAt: "2026-05-25T14:00:00Z",
    actorId: "p1",
  });
  const r1 = appendRecord(r0, {
    eventType: "MODIFY",
    entryId: "e1",
    payloadHash: hashContent({ total: 95 }),
    recordedAt: "2026-05-25T15:00:00Z",
    actorId: "p1",
  });
  const r2 = appendRecord(r1, {
    eventType: "SIGN",
    entryId: "e1",
    payloadHash: hashContent({ sig: "abc" }),
    recordedAt: "2026-05-25T16:00:00Z",
    actorId: "instr1",
  });
  return [r0, r1, r2];
}

describe("hash-chained audit ledger", () => {
  it("links genesis correctly", () => {
    const [r0] = buildChain();
    expect(r0!.seq).toBe(0);
    expect(r0!.prevHash).toBe(GENESIS_HASH);
  });

  it("verifies an intact chain", () => {
    expect(verifyChain(buildChain()).valid).toBe(true);
  });

  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("detects tampering with a past payload", () => {
    const chain = buildChain();
    chain[1] = { ...chain[1]!, payloadHash: hashContent({ total: 9999 }) };
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(1);
  });

  it("detects a removed record (broken sequence/link)", () => {
    const chain = buildChain();
    const tampered = [chain[0]!, chain[2]!];
    const v = verifyChain(tampered);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(2);
  });

  it("detects a reordered chain", () => {
    const chain = buildChain();
    const v = verifyChain([chain[1]!, chain[0]!, chain[2]!]);
    expect(v.valid).toBe(false);
  });
});
