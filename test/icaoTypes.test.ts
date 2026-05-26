import { describe, it, expect } from "vitest";
import { categoryForDescription } from "../src/data/icaoTypes.js";
import { fromIcaoTypesCsv } from "../src/db/seedIcaoTypes.js";

describe("ICAO description to category mapping", () => {
  it("maps fixed-wing descriptions to aeroplane", () => {
    expect(categoryForDescription("LandPlane")).toBe("AEROPLANE");
    expect(categoryForDescription("SeaPlane")).toBe("AEROPLANE");
    expect(categoryForDescription("Amphibian")).toBe("AEROPLANE");
  });

  it("maps rotorcraft and tiltrotor to helicopter", () => {
    expect(categoryForDescription("Helicopter")).toBe("HELICOPTER");
    expect(categoryForDescription("Gyrocopter")).toBe("HELICOPTER");
    expect(categoryForDescription("Tiltrotor")).toBe("HELICOPTER");
  });

  it("maps balloon and glider", () => {
    expect(categoryForDescription("Balloon")).toBe("BALLOON");
    expect(categoryForDescription("Glider")).toBe("SAILPLANE");
  });

  it("defaults an unrecognised description to aeroplane", () => {
    expect(categoryForDescription("Spaceplane")).toBe("AEROPLANE");
    expect(categoryForDescription("")).toBe("AEROPLANE");
  });
});

describe("ICAO types CSV seed parsing", () => {
  it("reads the type, description and engine columns and keeps the first row per code", () => {
    const csv =
      "manufacturer,model ,type,description,engine,engine_count,wtc\n" +
      "EUROCOPTER,EC-135,EC35,Helicopter,Turboprop/Turboshaft,2,L\n" +
      "AIRBUS,H135,EC35,Helicopter,Turboprop/Turboshaft,2,L\n" +
      "PILATUS,PC-12,PC12,LandPlane,Turboprop/Turboshaft,1,L\n" +
      "Hot air Balloon,balloon,BALL,Balloon,-,-,-\n";
    const out = fromIcaoTypesCsv(csv);
    expect(out).toHaveLength(3); // EC35 deduped
    expect(out[0]).toEqual({ code: "EC35", description: "Helicopter", engineType: "Turboprop/Turboshaft", engineCount: 2 });
    expect(out.find((t) => t.code === "PC12")?.engineCount).toBe(1);
    // "-" engine and count become null.
    expect(out.find((t) => t.code === "BALL")).toEqual({ code: "BALL", description: "Balloon", engineType: null, engineCount: null });
  });

  it("rejects a CSV without the required columns", () => {
    expect(() => fromIcaoTypesCsv("foo,bar\n1,2\n")).toThrow();
  });
});
