import { describe, it, expect } from "vitest";
import { normalizeAdsbdb } from "../src/http/aircraftLookup.js";

describe("adsbdb aircraft normalisation", () => {
  it("maps a typical response to our record, under the requested registration", () => {
    const body = {
      response: {
        aircraft: {
          type: "PC-12/47E",
          icao_type: "PC12",
          manufacturer: "Pilatus",
          registration: "HBSFU",
          registered_owner: "Some Owner",
        },
      },
    };
    const rec = normalizeAdsbdb(body, "HB-SFU");
    expect(rec).not.toBeNull();
    expect(rec!.registration).toBe("HB-SFU"); // requested form, so a flight entry matches
    expect(rec!.model).toBe("Pilatus PC-12/47E");
    expect(rec!.icaoType).toBe("PC12");
    expect(rec!.category).toBe("AEROPLANE");
  });

  it("falls back to the ICAO type when manufacturer and type are absent", () => {
    const rec = normalizeAdsbdb({ response: { aircraft: { icao_type: "C172" } } }, "G-ABCD");
    expect(rec?.model).toBe("C172");
  });

  it("returns null for an unknown or empty response", () => {
    expect(normalizeAdsbdb({ response: "unknown aircraft" }, "X")).toBeNull();
    expect(normalizeAdsbdb({}, "X")).toBeNull();
    expect(normalizeAdsbdb(null, "X")).toBeNull();
    expect(normalizeAdsbdb({ response: { aircraft: {} } }, "X")).toBeNull();
  });
});
