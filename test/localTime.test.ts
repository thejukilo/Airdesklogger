import { describe, it, expect } from "vitest";
import { zonedWallClockToUtc, LocalTimeError } from "../src/domain/localTime.js";

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

  it("handles a timezone west of UTC (New York, summer)", () => {
    // 09:00 local EDT is UTC-4, so 13:00 UTC.
    const utc = zonedWallClockToUtc("2026-06-10T09:00", "America/New_York");
    expect(utc.toISOString()).toBe("2026-06-10T13:00:00.000Z");
  });

  it("rejects a value that is not a wall-clock time", () => {
    expect(() => zonedWallClockToUtc("nonsense", "Europe/Zurich")).toThrow(LocalTimeError);
  });
});
