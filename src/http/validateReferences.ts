/**
 * Reference checks that need the database (so they live here, not in the pure
 * domain validation). FOCA 2.3.2/2.3.3: places must be a known ICAO code or the
 * no-location indicator, and the aircraft (and FSTD device) must exist in the
 * reference database. These run in the create and amend endpoints after the pure
 * validation passes.
 */

import { isIcaoFormat, isNoLocationIndicator } from "../domain/icao.js";
import { airportExists, getAircraftForFlight, fstdDeviceExists, getIcaoType } from "../db/referenceRepository.js";
import type { FlightEntryInput, FstdSessionInput } from "../domain/types.js";

export interface ReferenceIssue {
  field: string;
  message: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  AEROPLANE: "aeroplane",
  HELICOPTER: "helicopter",
  SAILPLANE: "sailplane",
  BALLOON: "balloon",
};

export async function validateFlightReferences(input: FlightEntryInput): Promise<ReferenceIssue[]> {
  const issues: ReferenceIssue[] = [];

  // Balloons take off and land at ordinary places (a field by a village), not at
  // ICAO aerodromes, so their places are free text and not checked against the
  // airport database.
  if ((input.aircraft.category ?? "AEROPLANE") !== "BALLOON") {
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
  }

  const onDate = (input.legs[0]?.departureTime ?? new Date()).toISOString().slice(0, 10);
  const aircraft = await getAircraftForFlight(input.aircraft.registration, onDate);
  if (!aircraft) {
    issues.push({
      field: "aircraft.registration",
      message: `Aircraft ${input.aircraft.registration} is not in the reference database as of ${onDate}; add it first.`,
    });
  } else {
    // The registration is authoritative for the category. A flight may not be
    // logged under a category the aircraft does not belong to (for example a
    // single-engine aeroplane logged as a balloon). A type that the Doc 8643
    // list allows under more than one category (a motor-glider, as an aeroplane
    // or a sailplane) accepts any of them.
    const selected = input.aircraft.category ?? "AEROPLANE";
    const info = aircraft.icaoType ? await getIcaoType(aircraft.icaoType) : null;
    const allowed = info?.allowedCategories ?? (aircraft.category ? [aircraft.category] : []);
    if (allowed.length > 0 && !allowed.includes(selected)) {
      const allowedNames = allowed.map((c) => CATEGORY_NAMES[c]).join(" or ");
      issues.push({
        field: "aircraft.category",
        message: `${input.aircraft.registration} must be logged as a ${allowedNames}, not a ${CATEGORY_NAMES[selected]}.`,
      });
    }
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
