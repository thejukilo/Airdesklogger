/**
 * Reference checks that need the database (so they live here, not in the pure
 * domain validation). FOCA 2.3.2/2.3.3: places must be a known ICAO code or the
 * no-location indicator, and the aircraft (and FSTD device) must exist in the
 * reference database. These run in the create and amend endpoints after the pure
 * validation passes.
 */

import { isIcaoFormat, isNoLocationIndicator } from "../domain/icao.js";
import { airportExists, getAircraftForFlight, fstdDeviceExists } from "../db/referenceRepository.js";
import type { FlightEntryInput, FstdSessionInput } from "../domain/types.js";

export interface ReferenceIssue {
  field: string;
  message: string;
}

export async function validateFlightReferences(input: FlightEntryInput): Promise<ReferenceIssue[]> {
  const issues: ReferenceIssue[] = [];

  const places = new Set<string>();
  for (const leg of input.legs) {
    places.add(leg.departurePlace);
    places.add(leg.arrivalPlace);
  }
  for (const place of places) {
    if (isNoLocationIndicator(place)) continue;
    if (!isIcaoFormat(place)) {
      issues.push({ field: "legs.place", message: `Place "${place}" is not a valid ICAO code or the ZZZZ no-location indicator.` });
      continue;
    }
    if (!(await airportExists(place))) {
      issues.push({ field: "legs.place", message: `ICAO "${place}" is not in the airport reference database.` });
    }
  }

  const onDate = (input.legs[0]?.departureTime ?? new Date()).toISOString().slice(0, 10);
  if (!(await getAircraftForFlight(input.aircraft.registration, onDate))) {
    issues.push({
      field: "aircraft.registration",
      message: `Aircraft ${input.aircraft.registration} is not in the reference database as of ${onDate}; add it first.`,
    });
  }

  return issues;
}

export async function validateFstdReferences(input: FstdSessionInput): Promise<ReferenceIssue[]> {
  if (await fstdDeviceExists(input.qualificationNumber)) return [];
  return [
    {
      field: "qualificationNumber",
      message: `FSTD device ${input.qualificationNumber} is not in the reference database; add it first.`,
    },
  ];
}
