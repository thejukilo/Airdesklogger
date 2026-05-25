/**
 * Pilot function time and the countersignature rules for the hard cases.
 *
 * EASA capacities split into the four function-time sub-columns (PIC, co-pilot,
 * dual, instructor). The primary capacity is mutually exclusive and accounts for
 * the entire flight; instructor time is an independent annotation (a flight
 * instructor is normally also PIC, so logs both for the same flight).
 *
 * Two capacities count as PIC time but are not free-standing. They require a
 * countersignature before they are creditable:
 *   - PICUS (Pilot-in-Command Under Supervision): credited as PIC; the
 *     supervising PIC must countersign that the flight was conducted as PICUS.
 *   - SPIC (Student PIC): a student acting as PIC under instruction; credited as
 *     PIC; the instructor must countersign (and must not have influenced the
 *     conduct of the flight).
 */

import type { FunctionTime, PilotFunction, CountersignRole } from "./types.js";

/** Function capacities that are logged in the PIC column. */
const PIC_FUNCTIONS: ReadonlySet<PilotFunction> = new Set(["PIC", "PICUS", "SPIC"]);

export interface FunctionMinutes {
  pic: number;
  coPilot: number;
  dual: number;
  instructor: number;
}

/** Split the total block time across the function sub-columns (column 11). */
export function functionMinutes(fn: FunctionTime, totalMinutes: number): FunctionMinutes {
  return {
    pic: PIC_FUNCTIONS.has(fn.primary) ? totalMinutes : 0,
    coPilot: fn.primary === "CO_PILOT" ? totalMinutes : 0,
    dual: fn.primary === "DUAL" ? totalMinutes : 0,
    instructor: fn.instructor,
  };
}

export interface CountersignRequirement {
  required: boolean;
  role?: CountersignRole;
  reason?: string;
}

/**
 * Whether the entry must be countersigned before its function time is creditable.
 * PICUS → supervising PIC; SPIC → instructor. (Skill-test/examiner sign-off is a
 * separate lock handled by the signature subsystem.)
 */
export function countersignRequirement(fn: FunctionTime): CountersignRequirement {
  switch (fn.primary) {
    case "PICUS":
      return {
        required: true,
        role: "SUPERVISING_PIC",
        reason: "PICUS time must be countersigned by the supervising pilot-in-command.",
      };
    case "SPIC":
      return {
        required: true,
        role: "INSTRUCTOR",
        reason: "SPIC time must be countersigned by the supervising instructor.",
      };
    default:
      return { required: false };
  }
}

/** The annotation that EASA expects in the remarks column for these cases. */
export function functionRemark(fn: FunctionTime): string | null {
  if (fn.primary === "PICUS") return "PICUS";
  if (fn.primary === "SPIC") return "SPIC";
  return null;
}
