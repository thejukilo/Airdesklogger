/**
 * The EASA "multi-flight" rule, per AMC1 FCL.050(b)(1)(vi) and the Instructions
 * for Use point (f):
 *
 *   "if the holder of a licence carries out a number of flights upon the same day
 *    returning on each occasion to the same place of departure and the interval
 *    between successive flights does not exceed 30 minutes, such series of flights
 *    may be recorded as a single entry."
 *
 * Read carefully, this is the local-flying case: a series of flights from one
 * base, each one returning to that same base (circuits, training details), with
 * short turnarounds. It is NOT an out-and-back to a different airfield. So for a
 * combined entry every leg must depart from and return to the one common place.
 *
 * Conditions for combining into a single entry:
 *   1. all flights on the same UTC calendar day;
 *   2. every flight departs from and returns to the same place (the base);
 *   3. the ground gap between successive flights is under 30 minutes.
 *
 * Legs must also be chronologically ordered. A single-leg entry is always a
 * valid entry on its own; the combining conditions only bind with more than one.
 */

import type { FlightLeg } from "./types.js";
import { minutesBetween, utcDateKey } from "./time.js";

export const MAX_GROUND_GAP_MINUTES = 30;

export type MultiFlightViolationCode =
  | "EMPTY"
  | "LEG_NOT_POSITIVE_DURATION"
  | "LEGS_NOT_CHRONOLOGICAL"
  | "NOT_SAME_DAY"
  | "GAP_TOO_LARGE"
  | "NOT_RETURNING_TO_DEPARTURE_POINT";

export interface MultiFlightViolation {
  code: MultiFlightViolationCode;
  message: string;
  legIndex?: number;
}

export interface MultiFlightResult {
  valid: boolean;
  isMultiFlight: boolean;
  violations: MultiFlightViolation[];
}

export function validateMultiFlight(legs: readonly FlightLeg[]): MultiFlightResult {
  const violations: MultiFlightViolation[] = [];
  const isMultiFlight = legs.length > 1;

  if (legs.length === 0) {
    return {
      valid: false,
      isMultiFlight: false,
      violations: [{ code: "EMPTY", message: "An entry must contain at least one leg." }],
    };
  }

  // Every leg must have positive block time.
  legs.forEach((leg, i) => {
    if (minutesBetween(leg.departureTime, leg.arrivalTime) <= 0) {
      violations.push({
        code: "LEG_NOT_POSITIVE_DURATION",
        legIndex: i,
        message: `Leg ${i + 1}: arrival must be after departure.`,
      });
    }
  });

  // Conditions below only constrain a genuine multi-flight grouping.
  if (isMultiFlight) {
    const day0 = utcDateKey(legs[0]!.departureTime);
    const base = legs[0]!.departurePlace;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;

      // Same UTC day for both ends of every leg.
      if (utcDateKey(leg.departureTime) !== day0 || utcDateKey(leg.arrivalTime) !== day0) {
        violations.push({
          code: "NOT_SAME_DAY",
          legIndex: i,
          message: `Leg ${i + 1}: all legs of a combined entry must be on the same UTC day (${day0}).`,
        });
      }

      // Every flight must depart from and return to the same place of departure.
      if (leg.departurePlace !== base || leg.arrivalPlace !== base) {
        violations.push({
          code: "NOT_RETURNING_TO_DEPARTURE_POINT",
          legIndex: i,
          message: `Leg ${i + 1} (${leg.departurePlace} to ${leg.arrivalPlace}) must depart from and return to the base ${base} to be combined into one entry.`,
        });
      }

      if (i > 0) {
        const prev = legs[i - 1]!;
        const gap = minutesBetween(prev.arrivalTime, leg.departureTime);

        if (gap < 0) {
          violations.push({
            code: "LEGS_NOT_CHRONOLOGICAL",
            legIndex: i,
            message: `Leg ${i + 1} departs before leg ${i} arrives.`,
          });
        } else if (gap >= MAX_GROUND_GAP_MINUTES) {
          violations.push({
            code: "GAP_TOO_LARGE",
            legIndex: i,
            message: `Gap before leg ${i + 1} is ${gap} min; must be under ${MAX_GROUND_GAP_MINUTES} min to combine.`,
          });
        }
      }
    }
  }

  return { valid: violations.length === 0, isMultiFlight, violations };
}
