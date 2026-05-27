import { describe, it, expect } from "vitest";
import { fromSimulatorsCsv } from "../src/db/seedSimulators.js";

describe("simulator CSV seed parsing", () => {
  const csv =
    "easa_code,serial_number,eval_type,aircraft_man,aircraft_type,sim_man,qualification,location\n" +
    "AT-FFS-1112,2TE3-787,R,Embraer,A330-200,CAE,D,Paris CDG\n" +
    'CH-123,CAE-2NF7,R,Airbus,AT-802,"ASG, Belgium",2,"Cargolux, Luxembourg"\n' +
    "CH-123,OTHER-SN,R,Airbus,A320,CAE,D,Brussels\n" + // duplicate easa_code dropped
    "BE-FNPT-029,GEN-1,,Not Applicable,C510,Frasca,2,Grenoble\n";

  it("reads the columns and handles quoted fields with commas", () => {
    const out = fromSimulatorsCsv(csv);
    expect(out).toHaveLength(3); // CH-123 deduped to one
    const ch = out.find((s) => s.easaCode === "CH-123")!;
    expect(ch.serialNumber).toBe("CAE-2NF7"); // first row wins
    expect(ch.simManufacturer).toBe("ASG, Belgium");
    expect(ch.location).toBe("Cargolux, Luxembourg");
    expect(ch.aircraftType).toBe("AT-802");
  });

  it('treats "Not Applicable" and blanks as null', () => {
    const be = fromSimulatorsCsv(csv).find((s) => s.easaCode === "BE-FNPT-029")!;
    expect(be.aircraftManufacturer).toBeNull(); // "Not Applicable"
    expect(be.evalType).toBeNull(); // blank
  });

  it("requires an easa_code column", () => {
    expect(() => fromSimulatorsCsv("foo,bar\n1,2\n")).toThrow();
  });
});
