/**
 * Core domain types for an EASA logbook entry.
 *
 * An entry may represent a single flight or a "multi-flight" grouping of legs
 * (see multiFlight.ts). All times are UTC instants; all durations are minutes.
 */

import type { EntryAttribute } from "./attributes.js";

/** A logbook record is either a flown flight or a synthetic training session. */
export type EntryKind = "FLIGHT" | "FSTD";

/** EASA primary pilot capacity. Mutually exclusive, and it covers the whole flight. */
export type PilotFunction = "PIC" | "PICUS" | "SPIC" | "CO_PILOT" | "DUAL";

/** Who must countersign, if anyone. */
export type CountersignRole = "SUPERVISING_PIC" | "INSTRUCTOR" | "EXAMINER";

export interface Aircraft {
  /** Make/model/variant, e.g. "Cessna 172S". Column 4. */
  makeModelVariant: string;
  /** Registration, e.g. "G-ABCD". Column 4. */
  registration: string;
  /** Single-engine vs multi-engine drives columns 5 vs 6. */
  engineClass: "SE" | "ME";
  /** Multi-pilot type/operation drives column 6. */
  multiPilot: boolean;
}

/** One flight leg (off-blocks to on-blocks). Columns 2 & 3. */
export interface FlightLeg {
  departurePlace: string;
  departureTime: Date; // UTC
  arrivalPlace: string;
  arrivalTime: Date; // UTC
}

export interface Landings {
  day: number;
  night: number;
}

/** Operational condition time, column 10. Minutes. */
export interface OperationalConditionTime {
  night: number;
  ifr: number;
}

/** Pilot function time, column 11. */
export interface FunctionTime {
  primary: PilotFunction;
  /** Instructor minutes (independent of primary; an FI is usually also PIC). */
  instructor: number;
}

/**
 * A logbook entry as authored by a pilot. This is the input shape; computed
 * column values (totals, PIC minutes, etc.) are derived in validation/totals.
 */
export interface FlightEntryInput {
  pilotId: string;
  aircraft: Aircraft;
  legs: FlightLeg[];
  picName: string; // column 8; "SELF" allowed
  landings: Landings; // column 9
  conditions: OperationalConditionTime; // column 10
  function: FunctionTime; // column 11
  remarks: string; // column 12
  /** Operating crew size: 2 (normal), or 3/4 for augmented operation (FOCA 2.3.4). */
  crewSize?: number;
  /** Structured FOCA attributes (skill test, cross country, etc.). */
  attributes?: EntryAttribute[];
  /** True when any time in the entry was supplied as local time (FOCA 2.2.7). */
  enteredInLocalTime?: boolean;
}

/**
 * A synthetic training (FSTD) session, recorded on its own logbook row with the
 * flight columns left blank. Column 11 of AMC1 FCL.050. Total time of the
 * session includes pre- and after-flight checks. The exercise (for example a
 * proficiency check) goes in the remarks.
 */
export interface FstdSessionInput {
  pilotId: string;
  /** Aircraft type for a full simulator, or "FNPT I" / "FNPT II" for other devices. */
  deviceType: string;
  /** Qualification number of the device. */
  qualificationNumber: string;
  /** Whether the session was instruction received, and a short description. */
  instruction: string;
  date: Date; // UTC
  totalMinutes: number;
  remarks: string;
  attributes?: EntryAttribute[];
  enteredInLocalTime?: boolean;
}

/** Derived FSTD column values (column 11). */
export interface FstdColumns {
  date: string; // yyyy-mm-dd UTC
  deviceType: string;
  qualificationNumber: string;
  instruction: string;
  totalMinutes: number;
}

/** Fully derived column values, ready for storage / totals / PDF. */
export interface DerivedColumns {
  kind: EntryKind;
  date: string; // yyyy-mm-dd UTC (column 1)
  departurePlace: string;
  departureTime: Date;
  arrivalPlace: string;
  arrivalTime: Date;
  singleEngine: number; // column 5a
  multiEngine: number; // column 5b
  multiPilot: number; // column 6
  total: number; // column 7
  dayLandings: number; // column 9a
  nightLandings: number; // column 9b
  night: number; // column 10a
  ifr: number; // column 10b
  pic: number; // column 11a (incl. PICUS/SPIC)
  coPilot: number; // column 11b
  dual: number; // column 11c
  instructor: number; // column 11d
  isMultiFlight: boolean;
  /** Operating crew size; 3 or 4 means the logged times are a share (FOCA 2.3.4). */
  crewSize: number;
  /** Present only when kind is FSTD (column 11 of the layout). */
  fstd?: FstdColumns;
  /** Structured FOCA attributes applied to the entry. */
  attributes: EntryAttribute[];
  /** True when any time was entered as local time (flagged on exports). */
  enteredInLocalTime: boolean;
  /** True when an attribute requires a sign-off that is not yet present. */
  signatureRequired: boolean;
}
