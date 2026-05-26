import { describe, it, expect } from "vitest";
import { normalizeAirlabs } from "../src/http/aircraftLookup.js";

describe("airlabs aircraft normalisation", () => {
  it("maps a landplane response to an aeroplane record under the requested registration", () => {
    const body = {
      response: [
        {
          reg_number: "N732AN",
          icao: "B77W",
          iata: "77W",
          manufacturer: "Boeing",
          model: "Boeing 777-300ER pax",
          type: "landplane",
          engine: "jet",
          engine_count: "2",
          category: "H", // wake-turbulence class, must not drive our category
        },
      ],
    };
    const rec = normalizeAirlabs(body, "N732AN");
    expect(rec).not.toBeNull();
    expect(rec!.registration).toBe("N732AN");
    expect(rec!.model).toBe("Boeing 777-300ER pax"); // manufacturer not repeated
    expect(rec!.icaoType).toBe("B77W");
    expect(rec!.category).toBe("AEROPLANE");
    expect(rec!.engineType).toBe("jet");
    expect(rec!.engineCount).toBe(2);
  });

  it("classifies a helicopter from the type description", () => {
    const rec = normalizeAirlabs(
      { response: [{ reg_number: "HB-ZXX", icao: "EC35", model: "Airbus H135", type: "helicopter" }] },
      "HB-ZXX",
    );
    expect(rec!.category).toBe("HELICOPTER");
  });

  it("classifies a balloon from the ICAO type designator", () => {
    const rec = normalizeAirlabs(
      { response: [{ reg_number: "HB-QXX", icao: "BALL", model: "Cameron Z-90" }] },
      "HB-QXX",
    );
    expect(rec!.category).toBe("BALLOON");
  });

  it("classifies a sailplane from the ICAO type designator", () => {
    const rec = normalizeAirlabs(
      { response: [{ reg_number: "HB-3XXX", icao: "GLID", model: "Schleicher ASK 21" }] },
      "HB-3XXX",
    );
    expect(rec!.category).toBe("SAILPLANE");
  });

  it("accepts a single response object as well as an array", () => {
    const rec = normalizeAirlabs({ response: { reg_number: "G-ABCD", icao: "C172" } }, "G-ABCD");
    expect(rec?.model).toBe("C172"); // falls back to the ICAO type when no model
    expect(rec?.category).toBe("AEROPLANE");
  });

  it("returns null for an unknown or empty response", () => {
    expect(normalizeAirlabs({ response: [] }, "X")).toBeNull();
    expect(normalizeAirlabs({}, "X")).toBeNull();
    expect(normalizeAirlabs(null, "X")).toBeNull();
    expect(normalizeAirlabs({ response: [{ reg_number: "X" }] }, "X")).toBeNull();
  });
});
