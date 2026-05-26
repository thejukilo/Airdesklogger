import { describe, it, expect } from "vitest";
import { parseAdsbdb } from "../src/http/aircraftLookup.js";

const adsbdb = (aircraft: Record<string, unknown>) => ({ response: { aircraft } });

describe("adsbdb response parsing", () => {
  it("pulls registration, model and ICAO type, under the requested registration", () => {
    const p = parseAdsbdb(adsbdb({ type: "PC-12/47E", icao_type: "PC12", manufacturer: "Pilatus" }), "HB-SFU");
    expect(p).not.toBeNull();
    expect(p!.registration).toBe("HB-SFU"); // requested form, so a flight entry matches
    expect(p!.model).toBe("Pilatus PC-12/47E");
    expect(p!.icaoType).toBe("PC12");
  });

  it("falls back to the ICAO type when manufacturer and type are absent", () => {
    expect(parseAdsbdb(adsbdb({ icao_type: "C172" }), "G-ABCD")?.model).toBe("C172");
  });

  it("returns null for an unknown or empty response", () => {
    expect(parseAdsbdb({ response: "unknown aircraft" }, "X")).toBeNull();
    expect(parseAdsbdb({}, "X")).toBeNull();
    expect(parseAdsbdb(null, "X")).toBeNull();
    expect(parseAdsbdb(adsbdb({}), "X")).toBeNull();
  });
});
