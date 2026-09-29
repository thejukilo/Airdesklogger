import { describe, it, expect } from "vitest";
import {
  detectCapzlogReport,
  parseCapzlogCsv,
  parseCapzlogDateTime,
  parseCapzlogDate,
  parseHhmm,
} from "../src/http/capzlog.js";

// Header rows copied verbatim from real capzlog.aero exports.
const AIRPLANE_HEADER =
  "Departure,Arrival,Off Block,On Block,Block,Takeoff,Landing,Airborne,Aircraft,Model,Single Engine,Multi Engine,Multi Pilot,PIC Name,Type of Flight,VFR,IFR,Day,Night,Pilot Function,PIC,Copi,Dual,Instructor,Landings,Day Landings,Night Landings,Remark,Mountain Landings,Mountain Takeoffs,Mountain Landings > 2000m,Mountain Landings > 2700m,Glacier Landings,Holding Patterns,Go Arounds,Touch and Goes,Number of PAX,Sea Takeoffs,Sea Landings,InstructionTime,HESLO1 Cycles,HESLO2 Cycles,HESLO3 Cycles,HESLO4 Cycles,HEC1 Cycles,HEC2 Cycles,HHO Cycles,HESLO1 Time,HESLO2 Time,HESLO3 Time,HESLO4 Time,HEC1 Time,HEC2 Time,HHO Time";
const SAILPLANE_HEADER =
  "Departure,Arrival,Off Block,On Block,Aircraft,Model,Type,PIC Name,Pilot Function,PIC,Dual,Instructor,Landings,Launch Method,Remark";
const BALLOON_HEADER =
  "Departure,Arrival,Off Block,On Block,Aircraft,Model,PIC Name,Pilot Function,PIC,Dual,Instructor,Landings,Remark";
const SIM_HEADER =
  "Date,Session Time,Aircraft,Model,Single Engine,Multi Engine,Pilot Function,Trainee,SFI/SFE,Remark,InstructionTime,Holding Patterns,Go Arounds,Touch and Goes";

describe("value parsing", () => {
  it("parses a M/D/YYYY H:MM datetime to a UTC-shaped instant", () => {
    expect(parseCapzlogDateTime("9/29/2026 10:10")).toBe("2026-09-29T10:10:00Z");
    expect(parseCapzlogDateTime("9/3/2026 15:33")).toBe("2026-09-03T15:33:00Z");
    expect(parseCapzlogDateTime("nope")).toBeNull();
  });
  it("parses a date-only value", () => {
    expect(parseCapzlogDate("9/29/2026")).toBe("2026-09-29");
  });
  it("parses H:MM durations to minutes", () => {
    expect(parseHhmm("2:30")).toBe(150);
    expect(parseHhmm("0:00")).toBe(0);
    expect(parseHhmm("")).toBe(0);
    expect(parseHhmm("bad")).toBeNull();
  });
});

describe("report detection", () => {
  it("identifies each report from its header", () => {
    expect(detectCapzlogReport(SIM_HEADER.split(","))).toBe("simulator");
    expect(detectCapzlogReport(SAILPLANE_HEADER.split(","))).toBe("sailplane");
    expect(detectCapzlogReport(AIRPLANE_HEADER.split(","))).toBe("airplane");
    expect(detectCapzlogReport(BALLOON_HEADER.split(","))).toBe("balloon");
    expect(detectCapzlogReport(["foo", "bar"])).toBeNull();
  });
});

describe("airplane report", () => {
  const csv =
    AIRPLANE_HEADER +
    "\nLSZN,LSZF,9/29/2026 10:10,9/29/2026 12:15,2:05,,,0:00,HB-SGZ,A210,2:05,0:00,0:00,Self,VFR,2:05,0:00,2:05,0:00,PIC,2:05,0:00,0:00,0:00,1,1,0,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0:00,0:00,0:00,0:00,0:00,0:00,0:00";

  it("maps a flight and seeds the aircraft", () => {
    const { report, rows, fatal } = parseCapzlogCsv(csv, { reportType: "airplane" });
    expect(fatal).toBeNull();
    expect(report).toBe("airplane");
    const r = rows[0]!;
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("FLIGHT");
    expect(r.entry?.legs[0]).toMatchObject({
      departurePlace: "LSZN",
      departureTime: "2026-09-29T10:10:00Z",
      arrivalPlace: "LSZF",
      arrivalTime: "2026-09-29T12:15:00Z",
    });
    expect(r.entry?.aircraft).toMatchObject({ registration: "HB-SGZ", engineClass: "SE", multiPilot: false, category: "AEROPLANE" });
    expect(r.entry?.picName).toBe("SELF");
    expect(r.entry?.function).toMatchObject({ primary: "PIC", instructor: 0 });
    expect(r.entry?.landings).toMatchObject({ day: 1, night: 0 });
    expect(r.aircraftSeed).toMatchObject({ registration: "HB-SGZ", category: "AEROPLANE", engineClass: "SE", icaoType: "A210" });
  });

  it("honours a helicopter override for the same layout", () => {
    const { rows } = parseCapzlogCsv(csv, { reportType: "helicopter" });
    expect(rows[0]?.entry?.aircraft.category).toBe("HELICOPTER");
    expect(rows[0]?.aircraftSeed?.category).toBe("HELICOPTER");
  });
});

describe("sailplane report", () => {
  const csv = SAILPLANE_HEADER + "\nEBBH,EBAW,9/3/2026 13:20,9/3/2026 15:30,3505,GLID,ASG 32,Self,PIC,2:10,0:00,0:00,1,Winch,";
  it("maps launch method, type and category", () => {
    const r = parseCapzlogCsv(csv).rows[0]!;
    expect(r.ok).toBe(true);
    expect(r.entry?.aircraft).toMatchObject({ category: "SAILPLANE", makeModelVariant: "ASG 32", engineClass: "SE" });
    expect(r.entry?.launchMethod).toBe("WINCH");
    expect(r.entry?.landings).toMatchObject({ day: 1, night: 0 });
  });
});

describe("balloon report", () => {
  const csv = BALLOON_HEADER + "\nHausen,Birrfeld,9/3/2026 15:33,9/3/2026 17:20,HB-QWE,BALL-H,Self,PIC,1:47,0:00,0:00,1,";
  it("keeps free-text places and sets balloon category", () => {
    const r = parseCapzlogCsv(csv).rows[0]!;
    expect(r.ok).toBe(true);
    expect(r.entry?.legs[0]?.departurePlace).toBe("Hausen");
    expect(r.entry?.legs[0]?.arrivalPlace).toBe("Birrfeld");
    expect(r.entry?.aircraft.category).toBe("BALLOON");
  });
});

describe("simulator report", () => {
  const csv = SIM_HEADER + "\n9/29/2026,2:30,1168,B738,0:00,2:30,Trainee,2:30,0:00,test remark,0,0,0,0";
  it("maps to an FSTD session", () => {
    const { report, rows } = parseCapzlogCsv(csv);
    expect(report).toBe("simulator");
    const r = rows[0]!;
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("FSTD");
    expect(r.fstd).toMatchObject({
      deviceType: "B738",
      qualificationNumber: "1168",
      pilotFunction: "TRAINEE",
      totalMinutes: 150,
      date: "2026-09-29T00:00:00Z",
      remarks: "test remark",
    });
  });
});

describe("file-level guards", () => {
  it("rejects a mismatched report choice", () => {
    const parsed = parseCapzlogCsv(SIM_HEADER + "\n9/29/2026,2:30,1168,B738,0:00,2:30,Trainee,2:30,0:00,,0,0,0,0", { reportType: "airplane" });
    expect(parsed.fatal).toMatch(/expected capzlog airplane columns/i);
  });
  it("flags a header-only file", () => {
    expect(parseCapzlogCsv(BALLOON_HEADER).fatal).toMatch(/no flights/i);
  });
});
