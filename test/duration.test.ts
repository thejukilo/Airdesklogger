import { describe, it, expect } from "vitest";
import { parseHHMM, formatHHMM, sumMinutes, DurationError } from "../src/domain/duration.js";

describe("duration HH:MM", () => {
  it("parses", () => {
    expect(parseHHMM("1:25")).toBe(85);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("123:59")).toBe(123 * 60 + 59);
  });

  it("rejects invalid minutes", () => {
    expect(() => parseHHMM("1:60")).toThrow(DurationError);
    expect(() => parseHHMM("1.5")).toThrow(DurationError);
  });

  it("formats with zero padding", () => {
    expect(formatHHMM(85)).toBe("01:25");
    expect(formatHHMM(0)).toBe("00:00");
    expect(formatHHMM(600)).toBe("10:00");
  });

  it("rejects negative / non-integer minutes", () => {
    expect(() => formatHHMM(-1)).toThrow(DurationError);
    expect(() => formatHHMM(1.5)).toThrow(DurationError);
  });

  it("round-trips", () => {
    for (const m of [0, 1, 59, 60, 85, 1439, 6000]) {
      expect(parseHHMM(formatHHMM(m))).toBe(m);
    }
  });

  it("sums exactly (integer minutes, no float drift)", () => {
    expect(sumMinutes([20, 20, 20])).toBe(60);
    expect(sumMinutes([])).toBe(0);
  });
});
