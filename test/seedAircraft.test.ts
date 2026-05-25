import { describe, it, expect } from "vitest";
import { fromAircraftCsv } from "../src/db/seedAircraft.js";

describe("aircraft CSV import", () => {
  it("reads registration, model, type and engine columns and uppercases the registration", () => {
    const csv =
      "registration,model,typecode,category,engine_type,engines,multi_pilot\n" +
      "hb-sgz,Aquila AT01,AT01,AEROPLANE,piston,1,false\n" +
      "G-ABCD,PA-34 Seneca,PA34,AEROPLANE,piston,2,false\n";
    const out = fromAircraftCsv(csv);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ registration: "HB-SGZ", model: "Aquila AT01", icaoType: "AT01", category: "AEROPLANE", engineCount: 1, multiPilot: false });
    expect(out[1]?.engineCount).toBe(2);
  });

  it("defaults an unknown category to aeroplane and skips rows without a registration", () => {
    const csv = "registration,model,category\nHB-XYZ,EC135,ROTORCRAFT\n,NoReg,AEROPLANE\n";
    const out = fromAircraftCsv(csv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ registration: "HB-XYZ", category: "AEROPLANE" });
  });

  it("keeps a recognised category", () => {
    const out = fromAircraftCsv("registration,model,category\nHB-HEL,EC135,HELICOPTER\n");
    expect(out[0]?.category).toBe("HELICOPTER");
  });

  it("rejects a CSV without the required columns", () => {
    expect(() => fromAircraftCsv("foo,bar\n1,2\n")).toThrow();
  });
});
