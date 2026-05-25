import { describe, it, expect } from "vitest";
import {
  isIcaoFormat,
  isNoLocationIndicator,
  normalizeIcao,
  NO_LOCATION_INDICATOR,
} from "../src/domain/icao.js";

describe("ICAO location indicators", () => {
  it("accepts four-letter codes", () => {
    expect(isIcaoFormat("EGKB")).toBe(true);
    expect(isIcaoFormat("lszh")).toBe(true); // normalised
  });

  it("rejects malformed codes", () => {
    expect(isIcaoFormat("EGK")).toBe(false);
    expect(isIcaoFormat("EGKBX")).toBe(false);
    expect(isIcaoFormat("EG1B")).toBe(false);
    expect(isIcaoFormat("")).toBe(false);
  });

  it("recognises the no-location indicator", () => {
    expect(isNoLocationIndicator("ZZZZ")).toBe(true);
    expect(isNoLocationIndicator("zzzz")).toBe(true);
    expect(isNoLocationIndicator("EGKB")).toBe(false);
    expect(NO_LOCATION_INDICATOR).toBe("ZZZZ");
  });

  it("normalises", () => {
    expect(normalizeIcao("  egkb ")).toBe("EGKB");
  });
});
