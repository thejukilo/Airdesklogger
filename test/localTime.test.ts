import { describe, it, expect } from "vitest";
import { zonedWallClockToUtc, zonedUtcToWallClock, LocalTimeError } from "../src/domain/localTime.js";

describe("local wall-clock to UTC against an aerodrome timezone", () => {
  it("applies the summer (daylight saving) offset for Zurich", () => {
    // 14:30 local in July is UTC+2, so 12:30 UTC.
    const utc = zonedWallClockToUtc("2026-07-01T14:30", "Europe/Zurich");
    expect(utc.toISOString()).toBe("2026-07-01T12:30:00.000Z");
  });

  it("applies the winter (standard) offset for Zurich", () => {
    // 14:30 local in January is UTC+1, so 13:30 UTC.
    const utc = zonedWallClockToUtc("2026-01-15T14:30", "Europe/Zurich");
    expect(utc.toISOString()).toBe("2026-01-15T13:30:00.000Z");
  });

  it("rejects a value carrying a zone marker (must be bare wall-clock)", () => {
    // The importer builds leg times with a trailing Z; a LOCAL-source time must
    // have that stripped before conversion (buildEntry.toWallClock), otherwise
    // the wall-clock regex refuses it. This documents that constraint.
    expect(() => zonedWallClockToUtc("2024-09-06T11:15:00Z", "Europe/Zurich")).toThrow(LocalTimeError);
    // And with the marker removed it converts (11:15 CEST -> 09:15 UTC).
    const utc = zonedWallClockToUtc("2024-09-06T11:15:00", "Europe/Zurich");
    expect(utc.toISOString()).toBe("2024-09-06T09:15:00.000Z");
  });

  it("handles a timezone west of UTC (New York, summer)", () => {
    // 09:00 local EDT is UTC-4, so 13:00 UTC.
    const utc = zonedWallClockToUtc("2026-06-10T09:00", "America/New_York");
    expect(utc.toISOString()).toBe("2026-06-10T13:00:00.000Z");
  });

  it("rejects a value that is not a wall-clock time", () => {
    expect(() => zonedWallClockToUtc("nonsense", "Europe/Zurich")).toThrow(LocalTimeError);
  });
});

describe("UTC to local wall-clock at an aerodrome timezone (token storeTimeZone = LOCAL)", () => {
  it("projects a UTC summer instant down to Zurich wall-clock", () => {
    // 12:30 UTC in July is 14:30 local in Zurich (CEST).
    const wall = zonedUtcToWallClock("2026-07-01T12:30:00Z", "Europe/Zurich");
    expect(wall).toBe("2026-07-01T14:30:00Z");
  });

  it("projects a UTC winter instant down to Zurich wall-clock", () => {
    const wall = zonedUtcToWallClock("2026-01-15T13:30:00Z", "Europe/Zurich");
    expect(wall).toBe("2026-01-15T14:30:00Z");
  });

  it("crosses the date boundary when the local zone is west of UTC", () => {
    // 02:00 UTC is 22:00 the previous day in EDT.
    const wall = zonedUtcToWallClock("2026-06-10T02:00:00Z", "America/New_York");
    expect(wall).toBe("2026-06-09T22:00:00Z");
  });

  it("rejects a non-UTC input", () => {
    expect(() => zonedUtcToWallClock("nonsense", "Europe/Zurich")).toThrow(LocalTimeError);
  });
});
