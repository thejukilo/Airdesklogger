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
export type PilotFunction = "PIC" | "PICUS" | "SPIC" | "CO_PILOT" | "DUAL" | "SAFETY_PILOT";

/** Operating role within the flight, independent of the logged function time. */
export type OperatingRole = "PILOT_FLYING" | "PILOT_MONITORING";

/** Who must countersign, if anyone. */
export type CountersignRole = "SUPERVISING_PIC" | "INSTRUCTOR" | "EXAMINER";

/** Aircraft category (FOCA 2.1.4). A TMG may be logged as aeroplane or sailplane. */
export type AircraftCategory = "AEROPLANE" | "HELICOPTER" | "SAILPLANE" | "BALLOON";

/** Sailplane launch method (FOCA 2.2.5). */
export type LaunchMethod = "WINCH" | "AEROTOW" | "SELF_LAUNCH" | "BUNGEE" | "CAR_TOW";

/**
 * Where an instructor or examiner sat (FOCA 2.2.4). Time spent on the jump seat
 * cannot be logged as PIC or instructor time per the Logging of Flight Time
 * document, so the position is recorded and validated.
 */
export type InstructorPosition = "PILOT_SEAT" | "JUMP_SEAT" | "SUPERVISING" | "EXAMINER";

export interface Aircraft {
  /** Make/model/variant, e.g. "Cessna 172S". Column 4. */
  makeModelVariant: string;
  /** Registration, e.g. "G-ABCD". Column 4. */
  registration: string;
  /** Single-engine vs multi-engine drives columns 5 vs 6. */
  engineClass: "SE" | "ME";
  /** Multi-pilot type/operation drives column 6. */
  multiPilot: boolean;
  /** Category; defaults to aeroplane when omitted. */
  category?: AircraftCategory | undefined;
}

/** One flight leg (off-blocks to on-blocks). Columns 2 & 3. */
export interface FlightLeg {
  departurePlace: string;
  departureTime: Date; // UTC
  arrivalPlace: string;
  arrivalTime: Date; // UTC
  /** Free-text place name, required when the place is the ZZZZ indicator (FOCA 2.3.3). */
  departurePlaceName?: string | undefined;
  arrivalPlaceName?: string | undefined;
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
  /** Where the instructor/examiner sat, when applicable (FOCA 2.2.4). */
  instructorPosition?: InstructorPosition | undefined;
  /** For a safety pilot, whether they took control (FOCA 2.3.5). */
  tookControl?: boolean | undefined;
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
  /** Operating role (pilot flying / monitoring), independent of function time. */
  operatingRole?: OperatingRole;
  /** Sailplane launch method, when the aircraft is a sailplane (FOCA 2.2.5). */
  launchMethod?: LaunchMethod;
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
  /** Free-text place names for the no-location (ZZZZ) case (FOCA 2.3.3). */
  departurePlaceName?: string | undefined;
  arrivalPlaceName?: string | undefined;
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
  /** Aircraft category for the entry (defaults to aeroplane). */
  category: AircraftCategory;
  /** Sailplane launch method, if recorded. */
  launchMethod?: LaunchMethod;
  /** Instructor/examiner seat position, if recorded. */
  instructorPosition?: InstructorPosition;
  /** Operating role, if recorded. */
  operatingRole?: OperatingRole;
  /** Present only when kind is FSTD (column 11 of the layout). */
  fstd?: FstdColumns;
  /** Structured FOCA attributes applied to the entry. */
  attributes: EntryAttribute[];
  /** True when any time was entered as local time (flagged on exports). */
  enteredInLocalTime: boolean;
  /** True when an attribute requires a sign-off that is not yet present. */
  signatureRequired: boolean;
}
