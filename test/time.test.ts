import { describe, it, expect } from "vitest";
import {
  parseUtcInstant,
  NonUtcTimeError,
  parseInstant,
  AmbiguousTimeError,
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

describe("local-time entry (FOCA 2.2.7)", () => {
  it("accepts UTC and marks it not-local", () => {
    const r = parseInstant("2026-05-25T10:00:00Z");
    expect(r.enteredLocal).toBe(false);
    expect(toUtcIso(r.utc)).toBe("2026-05-25T10:00:00Z");
  });

  it("accepts a local time with offset, converts to UTC, and flags it", () => {
    const r = parseInstant("2026-05-25T12:00:00+02:00");
    expect(r.enteredLocal).toBe(true);
    expect(toUtcIso(r.utc)).toBe("2026-05-25T10:00:00Z"); // 12:00 +02:00 == 10:00 UTC
  });

  it("treats +00:00 as UTC, not local", () => {
    expect(parseInstant("2026-05-25T10:00:00+00:00").enteredLocal).toBe(false);
  });

  it("rejects a timezone-less time (cannot convert)", () => {
    expect(() => parseInstant("2026-05-25T10:00:00")).toThrow(AmbiguousTimeError);
  });
});
