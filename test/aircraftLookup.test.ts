import { describe, it, expect } from "vitest";
import { normalizeAdsbdb } from "../src/http/aircraftLookup.js";

const adsbdb = (aircraft: Record<string, unknown>) => ({ response: { aircraft } });

describe("adsbdb aircraft normalisation", () => {
  it("maps a typical response to our record, under the requested registration", () => {
    const rec = normalizeAdsbdb(
      adsbdb({ type: "PC-12/47E", icao_type: "PC12", manufacturer: "Pilatus" }),
      "HB-SFU",
    );
    expect(rec).not.toBeNull();
    expect(rec!.registration).toBe("HB-SFU"); // requested form, so a flight entry matches
    expect(rec!.model).toBe("Pilatus PC-12/47E");
    expect(rec!.icaoType).toBe("PC12");
    expect(rec!.category).toBe("AEROPLANE"); // PC12 is a LandPlane
    expect(rec!.engineType).toBe("Turboprop/Turboshaft");
    expect(rec!.engineCount).toBe(1);
  });

  it("classifies a helicopter from the ICAO type designator", () => {
    const rec = normalizeAdsbdb(adsbdb({ icao_type: "EC35", manufacturer: "Airbus", type: "H135" }), "HB-ZXX");
    expect(rec!.category).toBe("HELICOPTER");
    expect(rec!.engineCount).toBe(2);
  });

  it("classifies a balloon and a glider from their designators", () => {
    expect(normalizeAdsbdb(adsbdb({ icao_type: "BALL", type: "Hot Air Balloon" }), "D-OGEL")!.category).toBe("BALLOON");
    expect(normalizeAdsbdb(adsbdb({ icao_type: "GLID", type: "ETA" }), "D-KFEM")!.category).toBe("SAILPLANE");
  });

  it("falls back to aeroplane for a designator not in the ICAO list", () => {
    const rec = normalizeAdsbdb(adsbdb({ icao_type: "ZZZZ", manufacturer: "Acme", type: "Widget" }), "G-ABCD");
    expect(rec!.category).toBe("AEROPLANE");
    expect(rec!.engineType).toBeUndefined();
  });

  it("falls back to the ICAO type when manufacturer and type are absent", () => {
    expect(normalizeAdsbdb(adsbdb({ icao_type: "C172" }), "G-ABCD")?.model).toBe("C172");
  });

  it("returns null for an unknown or empty response", () => {
    expect(normalizeAdsbdb({ response: "unknown aircraft" }, "X")).toBeNull();
    expect(normalizeAdsbdb({}, "X")).toBeNull();
    expect(normalizeAdsbdb(null, "X")).toBeNull();
    expect(normalizeAdsbdb(adsbdb({}), "X")).toBeNull();
  });
});
