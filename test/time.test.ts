import { describe, it, expect } from "vitest";
import {
  parseUtcInstant,
  NonUtcTimeError,
  toUtcIso,
  utcDateKey,
  formatLogbookDate,
  minutesBetween,
} from "../src/domain/time.js";

describe("UTC enforcement", () => {
  it("accepts Z-suffixed UTC", () => {
    expect(toUtcIso(parseUtcInstant("2026-05-25T14:30:00Z"))).toBe("2026-05-25T14:30:00Z");
  });

  it("accepts +00:00", () => {
    expect(toUtcIso(parseUtcInstant("2026-05-25T14:30:00+00:00"))).toBe("2026-05-25T14:30:00Z");
  });

  it("rejects non-zero offsets (local time)", () => {
    expect(() => parseUtcInstant("2026-05-25T14:30:00+02:00")).toThrow(NonUtcTimeError);
  });

  it("rejects zoneless timestamps (ambiguous local)", () => {
    expect(() => parseUtcInstant("2026-05-25T14:30:00")).toThrow(NonUtcTimeError);
  });

  it("rejects garbage", () => {
    expect(() => parseUtcInstant("not a date")).toThrow(NonUtcTimeError);
  });

  it("derives the logbook UTC date", () => {
    const d = parseUtcInstant("2026-05-25T23:59:00Z");
    expect(utcDateKey(d)).toBe("2026-05-25");
    expect(formatLogbookDate(d)).toBe("25/05/2026");
  });

  it("measures whole minutes", () => {
    const a = parseUtcInstant("2026-05-25T10:00:00Z");
    const b = parseUtcInstant("2026-05-25T11:25:00Z");
    expect(minutesBetween(a, b)).toBe(85);
  });
});
