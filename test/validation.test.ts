import { describe, it, expect } from "vitest";
import { validateEntry } from "../src/domain/validation.js";
import type { FlightEntryInput } from "../src/domain/types.js";

function baseEntry(over: Partial<FlightEntryInput> = {}): FlightEntryInput {
  return {
    pilotId: "p1",
    aircraft: { makeModelVariant: "Cessna 172S", registration: "G-ABCD", engineClass: "SE", multiPilot: false },
    legs: [
      {
        departurePlace: "EGKB",
        departureTime: new Date("2026-05-25T08:00:00Z"),
        arrivalPlace: "LFAT",
        arrivalTime: new Date("2026-05-25T09:30:00Z"),
      },
    ],
    picName: "SELF",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 30 },
    function: { primary: "PIC", instructor: 0 },
    remarks: "",
    ...over,
  };
}

describe("entry validation & column derivation", () => {
  it("derives the 12 columns for a single-engine PIC flight", () => {
    const r = validateEntry(baseEntry());
    expect(r.valid).toBe(true);
    const d = r.derived!;
    expect(d.date).toBe("2026-05-25");
    expect(d.total).toBe(90);
    expect(d.singleEngine).toBe(90);
    expect(d.multiEngine).toBe(0);
    expect(d.multiPilot).toBe(0);
    expect(d.pic).toBe(90);
    expect(d.ifr).toBe(30);
    expect(d.isMultiFlight).toBe(false);
  });

  it("routes a multi-pilot aircraft's time to the multi-pilot column", () => {
    const r = validateEntry(
      baseEntry({
        aircraft: { makeModelVariant: "A320", registration: "G-EZAB", engineClass: "ME", multiPilot: true },
        function: { primary: "CO_PILOT", instructor: 0 },
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.derived!.multiPilot).toBe(90);
    expect(r.derived!.singleEngine).toBe(0);
    expect(r.derived!.coPilot).toBe(90);
  });

  it("sums leg block times for a multi-flight entry of local flights", () => {
    const r = validateEntry(
      baseEntry({
        legs: [
          {
            departurePlace: "EGKB",
            departureTime: new Date("2026-05-25T09:00:00Z"),
            arrivalPlace: "EGKB",
            arrivalTime: new Date("2026-05-25T09:40:00Z"),
          },
          {
            departurePlace: "EGKB",
            departureTime: new Date("2026-05-25T10:00:00Z"),
            arrivalPlace: "EGKB",
            arrivalTime: new Date("2026-05-25T10:45:00Z"),
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.derived!.total).toBe(85);
    expect(r.derived!.isMultiFlight).toBe(true);
    expect(r.derived!.departurePlace).toBe("EGKB");
    expect(r.derived!.arrivalPlace).toBe("EGKB");
  });

  it("rejects night time exceeding total", () => {
    const r = validateEntry(baseEntry({ conditions: { night: 999, ifr: 0 } }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "conditions.night")).toBe(true);
  });

  it("rejects instructor time exceeding total", () => {
    const r = validateEntry(baseEntry({ function: { primary: "PIC", instructor: 999 } }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "function.instructor")).toBe(true);
  });

  it("requires a PIC name", () => {
    const r = validateEntry(baseEntry({ picName: "  " }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "picName")).toBe(true);
  });

  it("rejects PIC or instructor time logged from the jump seat", () => {
    const r = validateEntry(
      baseEntry({ function: { primary: "PIC", instructor: 30, instructorPosition: "JUMP_SEAT" } }),
    );
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "function.instructor")).toBe(true);
    expect(r.issues.some((i) => i.field === "function.primary")).toBe(true);
  });

  it("logs a safety pilot's time only when they took control (FOCA 2.3.5)", () => {
    const tookControl = validateEntry(
      baseEntry({ function: { primary: "SAFETY_PILOT", instructor: 0, tookControl: true } }),
    );
    expect(tookControl.valid).toBe(true);
    expect(tookControl.derived!.total).toBe(90); // block time, logged as PIC
    expect(tookControl.derived!.pic).toBe(90);

    const noControl = validateEntry(
      baseEntry({ function: { primary: "SAFETY_PILOT", instructor: 0, tookControl: false } }),
    );
    expect(noControl.valid).toBe(true);
    expect(noControl.derived!.total).toBe(0); // no creditable time
    expect(noControl.derived!.pic).toBe(0);
  });

  it("records the operating role", () => {
    const r = validateEntry(baseEntry({ operatingRole: "PILOT_MONITORING" }));
    expect(r.valid).toBe(true);
    expect(r.derived!.operatingRole).toBe("PILOT_MONITORING");
  });

  it("allows a launch method only for a sailplane", () => {
    const onAeroplane = validateEntry(baseEntry({ launchMethod: "WINCH" }));
    expect(onAeroplane.valid).toBe(false);
    expect(onAeroplane.issues.some((i) => i.field === "launchMethod")).toBe(true);

    const onSailplane = validateEntry(
      baseEntry({
        aircraft: { makeModelVariant: "ASK-21", registration: "G-GLID", engineClass: "SE", multiPilot: false, category: "SAILPLANE" },
        launchMethod: "WINCH",
      }),
    );
    expect(onSailplane.valid).toBe(true);
    expect(onSailplane.derived!.launchMethod).toBe("WINCH");
    expect(onSailplane.derived!.category).toBe("SAILPLANE");
  });
});
