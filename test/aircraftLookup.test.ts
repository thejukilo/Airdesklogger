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
          registered_owner_operator_flag_code: "PC12",
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

  it("classifies a balloon from the BALL ICAO type designator", () => {
    const body = {
      response: {
        aircraft: {
          type: "BB 85Z Hot Air Balloon",
          icao_type: "BALL",
          manufacturer: "Balony Kubicek",
          registered_owner_operator_flag_code: "BALL",
        },
      },
    };
    const rec = normalizeAdsbdb(body, "D-OGEL");
    expect(rec!.model).toBe("Balony Kubicek BB 85Z Hot Air Balloon");
    expect(rec!.category).toBe("BALLOON");
  });

  it("classifies a glider from the GLID ICAO type designator", () => {
    const body = {
      response: {
        aircraft: {
          type: "ETA",
          icao_type: "GLID",
          manufacturer: "Kickert",
          registered_owner_operator_flag_code: "GLID",
        },
      },
    };
    const rec = normalizeAdsbdb(body, "D-KFEM");
    expect(rec!.category).toBe("SAILPLANE");
  });

  it("falls back to the ICAO type when manufacturer and type are absent", () => {
    const rec = normalizeAdsbdb({ response: { aircraft: { icao_type: "C172" } } }, "G-ABCD");
    expect(rec?.model).toBe("C172");
    expect(rec?.category).toBe("AEROPLANE");
  });

  it("returns null for an unknown or empty response", () => {
    expect(normalizeAdsbdb({ response: "unknown aircraft" }, "X")).toBeNull();
    expect(normalizeAdsbdb({}, "X")).toBeNull();
    expect(normalizeAdsbdb(null, "X")).toBeNull();
    expect(normalizeAdsbdb({ response: { aircraft: {} } }, "X")).toBeNull();
  });
});
