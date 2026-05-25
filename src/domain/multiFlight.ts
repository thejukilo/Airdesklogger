/**
 * The EASA "multi-flight" rule.
 *
 * Several flights may be combined into a SINGLE logbook entry only when ALL of:
 *   1. they occur on the same (UTC) calendar day;
 *   2. the sequence returns to its original departure point;
 *   3. the ground gap between consecutive flights is under 30 minutes.
 *
 * We also enforce two physical preconditions that the rule presumes: legs are
 * chronologically ordered, and each leg departs from where the previous one
 * landed (continuity). A single-leg entry is always valid as an entry; the
 * multi-flight conditions only bind when there is more than one leg.
 */

import type { FlightLeg } from "./types.js";
import { minutesBetween, utcDateKey } from "./time.js";

export const MAX_GROUND_GAP_MINUTES = 30;

export type MultiFlightViolationCode =
  | "EMPTY"
  | "LEG_NOT_POSITIVE_DURATION"
  | "LEGS_NOT_CHRONOLOGICAL"
  | "PLACE_DISCONTINUITY"
  | "NOT_SAME_DAY"
  | "GAP_TOO_LARGE"
  | "NOT_RETURN_TO_ORIGIN";

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

      if (i > 0) {
        const prev = legs[i - 1]!;

        // Chronological ordering.
        if (minutesBetween(prev.arrivalTime, leg.departureTime) < 0) {
          violations.push({
            code: "LEGS_NOT_CHRONOLOGICAL",
            legIndex: i,
            message: `Leg ${i + 1} departs before leg ${i} arrives.`,
          });
        } else {
          // Ground gap under the limit.
          const gap = minutesBetween(prev.arrivalTime, leg.departureTime);
          if (gap >= MAX_GROUND_GAP_MINUTES) {
            violations.push({
              code: "GAP_TOO_LARGE",
              legIndex: i,
              message: `Gap before leg ${i + 1} is ${gap} min; must be under ${MAX_GROUND_GAP_MINUTES} min to combine.`,
            });
          }
        }

        // Continuity of place.
        if (prev.arrivalPlace !== leg.departurePlace) {
          violations.push({
            code: "PLACE_DISCONTINUITY",
            legIndex: i,
            message: `Leg ${i + 1} departs ${leg.departurePlace} but previous leg landed at ${prev.arrivalPlace}.`,
          });
        }
      }
    }

    // Return to origin.
    const first = legs[0]!;
    const last = legs[legs.length - 1]!;
    if (first.departurePlace !== last.arrivalPlace) {
      violations.push({
        code: "NOT_RETURN_TO_ORIGIN",
        message: `Combined entry must return to origin: started at ${first.departurePlace}, ended at ${last.arrivalPlace}.`,
      });
    }
  }

  return { valid: violations.length === 0, isMultiFlight, violations };
}
