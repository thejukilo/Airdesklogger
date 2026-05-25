import { describe, it, expect } from "vitest";
import { loggedMinutes, isValidCrewSize } from "../src/domain/crew.js";
import { validateEntry } from "../src/domain/validation.js";
import type { FlightEntryInput } from "../src/domain/types.js";

describe("augmented-crew share (FOCA 2.3.4)", () => {
  it("logs the full time for a normal crew of two", () => {
    expect(loggedMinutes(180, 2)).toBe(180);
  });

  it("logs two thirds for a crew of three", () => {
    expect(loggedMinutes(180, 3)).toBe(120);
    expect(loggedMinutes(100, 3)).toBe(67); // rounded
  });

  it("logs one half for a crew of four", () => {
    expect(loggedMinutes(180, 4)).toBe(90);
    expect(loggedMinutes(91, 4)).toBe(46); // rounded
  });

  it("validates the crew size", () => {
    expect(isValidCrewSize(2)).toBe(true);
    expect(isValidCrewSize(3)).toBe(true);
    expect(isValidCrewSize(4)).toBe(true);
    expect(isValidCrewSize(1)).toBe(false);
    expect(isValidCrewSize(5)).toBe(false);
  });
});

function mpFlight(over: Partial<FlightEntryInput> = {}): FlightEntryInput {
  return {
    pilotId: "p1",
    aircraft: { makeModelVariant: "A350", registration: "G-LONG", engineClass: "ME", multiPilot: true },
    legs: [
      {
        departurePlace: "EGLL",
        departureTime: new Date("2026-05-25T00:00:00Z"),
        arrivalPlace: "KLAX",
        arrivalTime: new Date("2026-05-25T03:00:00Z"),
      },
    ],
    picName: "SELF",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 180 },
    function: { primary: "CO_PILOT", instructor: 0 },
    remarks: "long haul",
    ...over,
  };
}

describe("augmented crew through validation", () => {
  it("scales total, function and IFR time by the crew share", () => {
    const r = validateEntry(mpFlight({ crewSize: 3 }));
    expect(r.valid).toBe(true);
    const d = r.derived!;
    expect(d.total).toBe(120); // 180 block, 2/3
    expect(d.multiPilot).toBe(120);
    expect(d.coPilot).toBe(120);
    expect(d.ifr).toBe(120); // 180 IFR scaled too
    expect(d.crewSize).toBe(3);
  });

  it("logs the full time when the crew is two", () => {
    const r = validateEntry(mpFlight({ crewSize: 2 }));
    expect(r.derived!.total).toBe(180);
  });

  it("rejects augmented crew on a single-pilot aircraft", () => {
    const r = validateEntry(
      mpFlight({
        crewSize: 3,
        aircraft: { makeModelVariant: "C172", registration: "G-AB", engineClass: "SE", multiPilot: false },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "crewSize")).toBe(true);
  });

  it("rejects an out-of-range crew size", () => {
    const r = validateEntry(mpFlight({ crewSize: 5 }));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "crewSize")).toBe(true);
  });
});
