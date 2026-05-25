/**
 * Integration test for the reference databases and the reference validation
 * (FOCA 2.3.2, 2.3.3). Skipped unless a database connection is configured.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { closePool } from "../src/db/pool.js";
import {
  upsertAirport,
  airportExists,
  upsertAircraft,
  getAircraftForFlight,
  upsertFstdDevice,
  fstdDeviceExists,
} from "../src/db/referenceRepository.js";
import { validateFlightReferences, validateFstdReferences } from "../src/http/validateReferences.js";
import type { FlightEntryInput, FstdSessionInput } from "../src/domain/types.js";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
const reg = () => `G-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

function flight(registration: string, dep: string, arr: string): FlightEntryInput {
  return {
    pilotId: "p1",
    aircraft: { makeModelVariant: "C172", registration, engineClass: "SE", multiPilot: false },
    legs: [
      {
        departurePlace: dep,
        departureTime: new Date("2026-05-25T08:00:00Z"),
        arrivalPlace: arr,
        arrivalTime: new Date("2026-05-25T09:00:00Z"),
      },
    ],
    picName: "SELF",
    landings: { day: 1, night: 0 },
    conditions: { night: 0, ifr: 0 },
    function: { primary: "PIC", instructor: 0 },
    remarks: "",
  };
}

describe.skipIf(!hasDb)("reference data and validation (integration)", () => {
  beforeAll(async () => {
    await migrate();
  });
  afterAll(async () => {
    await closePool();
  });

  it("stores and looks up airports", async () => {
    await upsertAirport({ icao: "EGKB", name: "London Biggin Hill" });
    expect(await airportExists("EGKB")).toBe(true);
    expect(await airportExists("egkb")).toBe(true); // normalised
    expect(await airportExists("ZZZZ")).toBe(false);
  });

  it("returns the aircraft record valid at the flight date", async () => {
    const registration = reg();
    await upsertAircraft({ registration, model: "Cessna 172S", category: "AEROPLANE", validFrom: "2020-01-01" });
    const found = await getAircraftForFlight(registration, "2026-05-25");
    expect(found?.model).toBe("Cessna 172S");
    expect(await getAircraftForFlight(registration, "2019-01-01")).toBeNull();
  });

  it("accepts a flight whose airports and aircraft are known, plus ZZZZ", async () => {
    const registration = reg();
    await upsertAirport({ icao: "EGKB", name: "Biggin Hill" });
    await upsertAircraft({ registration, model: "C172", category: "AEROPLANE" });
    expect(await validateFlightReferences(flight(registration, "EGKB", "EGKB"))).toEqual([]);
    // ZZZZ (no-location indicator) is allowed without being in the database.
    expect(await validateFlightReferences(flight(registration, "EGKB", "ZZZZ"))).toEqual([]);
  });

  it("rejects an unknown ICAO and an unknown aircraft", async () => {
    const registration = reg(); // never inserted
    const issues = await validateFlightReferences(flight(registration, "EGKB", "XXXX"));
    const fields = issues.map((i) => i.field);
    expect(fields).toContain("legs.place"); // XXXX not in DB
    expect(fields).toContain("aircraft.registration"); // not registered
  });

  it("validates FSTD devices against the reference database", async () => {
    const qual = `Q-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const fstd: FstdSessionInput = {
      pilotId: "p1",
      deviceType: "B737-800",
      qualificationNumber: qual,
      instruction: "OPC",
      date: new Date("2026-05-25T16:00:00Z"),
      totalMinutes: 200,
      remarks: "",
    };
    expect((await validateFstdReferences(fstd)).length).toBe(1); // not yet known
    await upsertFstdDevice({ qualificationNumber: qual, deviceKind: "FFS", level: "D" });
    expect(await fstdDeviceExists(qual)).toBe(true);
    expect(await validateFstdReferences(fstd)).toEqual([]);
  });
});
