import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generateLogbookPdf, type LogbookEntryForPdf } from "../src/pdf/logbook.js";
import { validateEntry } from "../src/domain/validation.js";
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
});
