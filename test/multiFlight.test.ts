import { describe, it, expect } from "vitest";
import { validateMultiFlight } from "../src/domain/multiFlight.js";
import type { FlightLeg } from "../src/domain/types.js";

const leg = (dp: string, dt: string, ap: string, at: string): FlightLeg => ({
  departurePlace: dp,
  departureTime: new Date(dt),
  arrivalPlace: ap,
  arrivalTime: new Date(at),
});

describe("multi-flight rule", () => {
  it("accepts a single leg unconditionally", () => {
    const r = validateMultiFlight([leg("EGLL", "2026-05-25T08:00:00Z", "LFPG", "2026-05-25T09:15:00Z")]);
    expect(r.valid).toBe(true);
    expect(r.isMultiFlight).toBe(false);
  });

  it("accepts a valid same-day return loop with sub-30-min gaps", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGMC", "2026-05-25T09:40:00Z"),
      leg("EGMC", "2026-05-25T10:00:00Z", "EGKB", "2026-05-25T10:45:00Z"),
    ]);
    expect(r.valid).toBe(true);
    expect(r.isMultiFlight).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("rejects a gap of 30 minutes or more", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGMC", "2026-05-25T09:40:00Z"),
      leg("EGMC", "2026-05-25T10:10:00Z", "EGKB", "2026-05-25T10:55:00Z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("GAP_TOO_LARGE");
  });

  it("accepts a gap of exactly 29 minutes (boundary)", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGMC", "2026-05-25T09:40:00Z"),
      leg("EGMC", "2026-05-25T10:09:00Z", "EGKB", "2026-05-25T10:55:00Z"),
    ]);
    expect(r.valid).toBe(true);
  });

  it("rejects when it does not return to origin", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGMC", "2026-05-25T09:40:00Z"),
      leg("EGMC", "2026-05-25T10:00:00Z", "EGSS", "2026-05-25T10:30:00Z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("NOT_RETURN_TO_ORIGIN");
  });

  it("rejects legs spanning two UTC days", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T23:50:00Z", "EGMC", "2026-05-26T00:10:00Z"),
      leg("EGMC", "2026-05-26T00:20:00Z", "EGKB", "2026-05-26T00:45:00Z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("NOT_SAME_DAY");
  });

  it("rejects a place discontinuity between legs", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGMC", "2026-05-25T09:40:00Z"),
      leg("EGSS", "2026-05-25T10:00:00Z", "EGKB", "2026-05-25T10:30:00Z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("PLACE_DISCONTINUITY");
  });

  it("rejects a leg with non-positive duration", () => {
    const r = validateMultiFlight([
      leg("EGKB", "2026-05-25T09:00:00Z", "EGKB", "2026-05-25T09:00:00Z"),
    ]);
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toContain("LEG_NOT_POSITIVE_DURATION");
  });
});
