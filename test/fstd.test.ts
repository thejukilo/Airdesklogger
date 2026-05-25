import { describe, it, expect } from "vitest";
import { validateFstdSession } from "../src/domain/validation.js";
import { paginate } from "../src/domain/totals.js";
import { generateLogbookPdf, type LogbookEntryForPdf } from "../src/pdf/logbook.js";
import type { FstdSessionInput } from "../src/domain/types.js";
import { validateEntry } from "../src/domain/validation.js";
import type { FlightEntryInput } from "../src/domain/types.js";

function fstdInput(over: Partial<FstdSessionInput> = {}): FstdSessionInput {
  return {
    pilotId: "p1",
    deviceType: "B737-800",
    qualificationNumber: "Q-1234",
    instruction: "OPC",
    date: new Date("2026-05-25T09:00:00Z"),
    totalMinutes: 250,
    remarks: "Operator proficiency check",
    ...over,
  };
}

describe("FSTD session validation", () => {
  it("derives an FSTD row with no flight time", () => {
    const r = validateFstdSession(fstdInput());
    expect(r.valid).toBe(true);
    const d = r.derived!;
    expect(d.kind).toBe("FSTD");
    expect(d.total).toBe(0);
    expect(d.fstd?.totalMinutes).toBe(250);
    expect(d.fstd?.deviceType).toBe("B737-800");
    expect(d.fstd?.qualificationNumber).toBe("Q-1234");
    expect(d.date).toBe("2026-05-25");
  });

  it("rejects a missing device type and a zero-length session", () => {
    expect(validateFstdSession(fstdInput({ deviceType: "" })).valid).toBe(false);
    expect(validateFstdSession(fstdInput({ totalMinutes: 0 })).valid).toBe(false);
  });
});

describe("FSTD totals are separate from flight totals", () => {
  it("accumulates fstdTotal without touching flight total", () => {
    const flightInput: FlightEntryInput = {
      pilotId: "p1",
      aircraft: { makeModelVariant: "C172", registration: "G-AB", engineClass: "SE", multiPilot: false },
      legs: [
        {
          departurePlace: "EGKB",
          departureTime: new Date("2026-05-25T08:00:00Z"),
          arrivalPlace: "EGKB",
          arrivalTime: new Date("2026-05-25T09:00:00Z"),
        },
      ],
      picName: "SELF",
      landings: { day: 1, night: 0 },
      conditions: { night: 0, ifr: 0 },
      function: { primary: "PIC", instructor: 0 },
      remarks: "",
    };
    const flight = validateEntry(flightInput).derived!;
    const fstd = validateFstdSession(fstdInput()).derived!;

    const { grandTotal } = paginate([flight, fstd], 10);
    expect(grandTotal.total).toBe(60); // only the flight contributes flight time
    expect(grandTotal.fstdTotal).toBe(250); // only the session contributes FSTD time
  });
});

describe("PDF renders an FSTD row", () => {
  it("produces a valid PDF that includes a simulator session", async () => {
    const fstdRow: LogbookEntryForPdf = {
      ...validateFstdSession(fstdInput()).derived!,
      aircraftType: "",
      aircraftReg: "",
      picName: "",
      remarks: "Operator proficiency check",
    };
    const bytes = await generateLogbookPdf([fstdRow], { pilotName: "A. Pilot", holderAddress: "1 Test Street" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
