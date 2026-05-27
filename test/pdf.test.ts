import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateLogbookPdf, type LogbookEntryForPdf } from "../src/pdf/logbook.js";
import { validateEntry, validateFstdSession } from "../src/domain/validation.js";
import type { FlightEntryInput } from "../src/domain/types.js";

function toPdfRow(input: FlightEntryInput): LogbookEntryForPdf {
  const d = validateEntry(input).derived!;
  return {
    ...d,
    aircraftType: input.aircraft.makeModelVariant,
    aircraftReg: input.aircraft.registration,
    picName: input.picName,
    remarks: input.remarks,
  };
}

function sampleInput(hourOffset: number): FlightEntryInput {
  const dep = new Date(Date.UTC(2026, 4, 25, 8 + hourOffset, 0, 0));
  const arr = new Date(dep.getTime() + 90 * 60000);
  return {
    pilotId: "p1",
    aircraft: { makeModelVariant: "Cessna 172S", registration: "G-ABCD", engineClass: "SE", multiPilot: false },
    legs: [{ departurePlace: "EGKB", departureTime: dep, arrivalPlace: "LFAT", arrivalTime: arr }],
    picName: "SELF",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 20 },
    function: { primary: "PIC", instructor: 0 },
    remarks: "training",
  };
}

describe("PDF logbook generation", () => {
  it("produces a valid PDF with the expected page count and carry-over", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => toPdfRow(sampleInput(i)));
    const bytes = await generateLogbookPdf(rows, { pilotName: "A. Pilot", licenseNumber: "UK.FCL.123", rowsPerPage: 3 });

    expect(bytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3); // 7 rows / 3 per page = 3 pages
  });

  it("produces a single page for an empty logbook", async () => {
    const bytes = await generateLogbookPdf([], { pilotName: "A. Pilot" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("lists FSTD sessions on their own page, not in the flight grid", async () => {
    const fstd = validateFstdSession({
      pilotId: "p1",
      deviceType: "A320-200",
      qualificationNumber: "AT-FFS-1112",
      qualification: "FFS Level D",
      pilotFunction: "TRAINEE",
      instruction: "",
      date: new Date(Date.UTC(2026, 4, 25, 9, 0, 0)),
      totalMinutes: 120,
      landings: { day: 2, night: 1 },
      remarks: "approaches",
    }).derived!;
    expect(fstd.fstd?.qualification).toBe("FFS Level D");
    expect(fstd.dayLandings).toBe(2);
    const fstdRow: LogbookEntryForPdf = { ...fstd, aircraftType: "", aircraftReg: "", picName: "", remarks: "approaches" };

    // One aeroplane flight + one FSTD session: one flight page plus one FSTD page.
    const bytes = await generateLogbookPdf([toPdfRow(sampleInput(0)), fstdRow], { pilotName: "A. Pilot", rowsPerPage: 5 });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);

    // An FSTD-only logbook still produces just the FSTD page (no empty flight grid).
    const fstdOnly = await generateLogbookPdf([fstdRow], { pilotName: "A. Pilot" });
    expect((await PDFDocument.load(fstdOnly)).getPageCount()).toBe(1);
  });
});
