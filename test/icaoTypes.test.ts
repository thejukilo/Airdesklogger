import { describe, it, expect } from "vitest";
import { allowedCategoriesForType, defaultCategoryForType } from "../src/data/icaoTypes.js";
import { fromIcaoTypesCsv } from "../src/db/seedIcaoTypes.js";

describe("ICAO type to category mapping", () => {
  it("maps fixed-wing descriptions to aeroplane (case-insensitively)", () => {
    expect(defaultCategoryForType("Landplane", null)).toBe("AEROPLANE");
    expect(defaultCategoryForType("LandPlane", "")).toBe("AEROPLANE");
    expect(defaultCategoryForType("Seaplane", "General Aviation")).toBe("AEROPLANE");
    expect(defaultCategoryForType("Amphibian", null)).toBe("AEROPLANE");
  });

  it("maps rotorcraft and tilt types to helicopter", () => {
    expect(defaultCategoryForType("Helicopter", null)).toBe("HELICOPTER");
    expect(defaultCategoryForType("Gyrocopter", null)).toBe("HELICOPTER");
    expect(defaultCategoryForType("Tiltrotor", null)).toBe("HELICOPTER");
    expect(defaultCategoryForType("Tilt-wing", null)).toBe("HELICOPTER");
  });

  it("maps the balloon description", () => {
    expect(defaultCategoryForType("Balloon", "Balloon")).toBe("BALLOON");
  });

  it("treats a glider role as a sailplane regardless of description", () => {
    expect(allowedCategoriesForType("Landplane", "Glider")).toEqual(["SAILPLANE"]);
  });

  it("lets a motor-glider be logged as an aeroplane or a sailplane (aeroplane default)", () => {
    expect(allowedCategoriesForType("Landplane", "Motor-Glider")).toEqual(["AEROPLANE", "SAILPLANE"]);
    expect(defaultCategoryForType("Landplane", "Motor-Glider")).toBe("AEROPLANE");
  });

  it("defaults an unrecognised type to aeroplane", () => {
    expect(defaultCategoryForType("Spaceplane", null)).toBe("AEROPLANE");
    expect(defaultCategoryForType("_unknown_", "_unknown_")).toBe("AEROPLANE");
  });
});

describe("ICAO types CSV seed parsing", () => {
  it("reads code, description, role and engine columns, keeping the first row per code", () => {
    const csv =
      "code,description,role,engine_type,engine_count\n" +
      "EC35,Helicopter,Helicopter,Turboprop,2\n" +
      "EC35,Helicopter,Helicopter,Turboprop,2\n" + // duplicate code ignored
      "PC12,Landplane,General Aviation,Turboprop,1\n" +
      "AS21,Landplane,Glider,No engine,0\n" +
      "BALL,Balloon,Balloon,No engine,0\n";
    const out = fromIcaoTypesCsv(csv);
    expect(out).toHaveLength(4); // EC35 deduped
    expect(out[0]).toEqual({ code: "EC35", description: "Helicopter", role: "Helicopter", engineType: "Turboprop", engineCount: 2 });
    expect(out.find((t) => t.code === "AS21")).toEqual({ code: "AS21", description: "Landplane", role: "Glider", engineType: "No engine", engineCount: null });
  });

  it("rejects a CSV without the required columns", () => {
    expect(() => fromIcaoTypesCsv("foo,bar\n1,2\n")).toThrow();
  });
});
