import { describe, it, expect } from "vitest";
import {
  isEntryAttribute,
  requiresSignature,
  attributesRequiringSignature,
} from "../src/domain/attributes.js";
import { validateEntry } from "../src/domain/validation.js";
import type { FlightEntryInput } from "../src/domain/types.js";

describe("structured entry attributes (FOCA 2.2.3)", () => {
  it("recognises known attributes and rejects unknown ones", () => {
    expect(isEntryAttribute("skill_test")).toBe(true);
    expect(isEntryAttribute("cross_country")).toBe(true);
    expect(isEntryAttribute("not_a_real_attribute")).toBe(false);
  });

  it("flags entries whose attributes need a sign-off (FOCA 2.4.6)", () => {
    expect(requiresSignature(["skill_test"])).toBe(true);
    expect(requiresSignature(["proficiency_check", "cross_country"])).toBe(true);
    expect(requiresSignature(["cross_country", "solo"])).toBe(false);
    expect(attributesRequiringSignature(["skill_test", "solo"])).toEqual(["skill_test"]);
  });
});

describe("attributes flow through validation", () => {
  function entry(attributes: string[]): FlightEntryInput {
    return {
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
      attributes: attributes as never,
    };
  }

  it("carries valid attributes into the derived columns and sets signatureRequired", () => {
    const r = validateEntry(entry(["cross_country", "skill_test"]));
    expect(r.valid).toBe(true);
    expect(r.derived!.attributes).toEqual(["cross_country", "skill_test"]);
    expect(r.derived!.signatureRequired).toBe(true);
  });

  it("rejects an unknown attribute", () => {
    const r = validateEntry(entry(["made_up"]));
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "attributes")).toBe(true);
  });
});

describe("attributes restricted to an aircraft category", () => {
  function entry(category: FlightEntryInput["aircraft"]["category"], attributes: string[]): FlightEntryInput {
    return {
      pilotId: "p1",
      aircraft: { makeModelVariant: "x", registration: "G-AB", engineClass: "SE", multiPilot: false, category },
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
      attributes: attributes as never,
    };
  }

  it("allows launch and cloud-flying privileges only on a sailplane", () => {
    expect(validateEntry(entry("AEROPLANE", ["launch_privilege"])).valid).toBe(false);
    expect(validateEntry(entry("AEROPLANE", ["cloud_flying_privilege"])).valid).toBe(false);
    expect(validateEntry(entry("SAILPLANE", ["launch_privilege", "cloud_flying_privilege"])).valid).toBe(true);
  });

  it("allows HESLO and HEC only on a helicopter", () => {
    expect(validateEntry(entry("AEROPLANE", ["heslo"])).valid).toBe(false);
    expect(validateEntry(entry("BALLOON", ["hec"])).valid).toBe(false);
    expect(validateEntry(entry("HELICOPTER", ["heslo", "hec"])).valid).toBe(true);
  });
});
