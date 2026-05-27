import { describe, it, expect } from "vitest";
import { fromAircraftCsv, enrichFromIcaoTypes, type IcaoModelInfo } from "../src/db/seedAircraft.js";

describe("aircraft CSV import", () => {
  it("reads registration, model, type, variant and engine columns and uppercases the registration", () => {
    const csv =
      "registration,model,icao_type,variant,category,engine_type,engine_count,multi_pilot,balloon_group\n" +
      "hb-sgz,AT01-100C,A210,,AEROPLANE,Piston Engine,,false,\n" +
      "G-ABCD,PA-34 Seneca,PA34,Seneca V,AEROPLANE,piston,2,false,\n";
    const out = fromAircraftCsv(csv);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ registration: "HB-SGZ", model: "AT01-100C", icaoType: "A210", category: "AEROPLANE", multiPilot: false });
    expect(out[1]).toMatchObject({ variant: "Seneca V", engineCount: 2 });
  });

  it("maps airship and rotorcraft categories, and defaults a truly unknown one to aeroplane", () => {
    const csv =
      "registration,model,category\n" +
      "HB-BVI,AS 105,Airship (Hot-air)\n" +
      "HB-XYZ,EC135,ROTORCRAFT\n" +
      "HB-ZZZ,Mystery,SPACEPLANE\n" +
      ",NoReg,AEROPLANE\n"; // skipped: no registration
    const out = fromAircraftCsv(csv);
    expect(out).toHaveLength(3);
    expect(out.find((a) => a.registration === "HB-BVI")?.category).toBe("BALLOON");
    expect(out.find((a) => a.registration === "HB-XYZ")?.category).toBe("HELICOPTER");
    expect(out.find((a) => a.registration === "HB-ZZZ")?.category).toBe("AEROPLANE");
  });

  it("keeps a row with a blank model when the type is known, using the code until enrichment fills it", () => {
    // Capital-B header and trailing empty columns, like the Europe export.
    const csv = "registration,model,icao_type,category,Balloon_group,country,,\n01AHA,,WT9,AEROPLANE,,France,,\n";
    const out = fromAircraftCsv(csv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ registration: "01AHA", model: "WT9", icaoType: "WT9" });
    enrichFromIcaoTypes(out, new Map([["WT9", { aircraftModel: "Aerospool WT-9 Dynamic", engineCount: 1 }]]));
    expect(out[0]?.model).toBe("Aerospool WT-9 Dynamic");
  });

  it("rejects a CSV without the required columns", () => {
    expect(() => fromAircraftCsv("foo,bar\n1,2\n")).toThrow();
  });
});

describe("aircraft enrichment from icao_types", () => {
  const icao = new Map<string, IcaoModelInfo>([
    ["A210", { aircraftModel: "Aquila A-210", engineCount: 1 }],
    ["C172", { aircraftModel: null, engineCount: 1 }], // ambiguous model: register model wins
  ]);

  it("takes the model and engine count from icao_types for a specific type", () => {
    const recs = fromAircraftCsv("registration,model,icao_type\nHB-SGZ,AT01-100C,A210\n");
    enrichFromIcaoTypes(recs, icao);
    expect(recs[0]).toMatchObject({ model: "Aquila A-210", engineCount: 1 });
  });

  it("keeps the register model for an ambiguous type and for generic GLID/BALL codes", () => {
    const recs = fromAircraftCsv("registration,model,icao_type\nHB-CAT,F172H,C172\nHB-1000,L 33 SOLO,GLID\n");
    enrichFromIcaoTypes(recs, icao);
    expect(recs.find((a) => a.registration === "HB-CAT")).toMatchObject({ model: "F172H", engineCount: 1 });
    expect(recs.find((a) => a.registration === "HB-1000")?.model).toBe("L 33 SOLO");
  });
});
