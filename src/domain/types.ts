/**
 * Core domain types for an EASA logbook entry.
 *
 * An entry may represent a single flight or a "multi-flight" grouping of legs
 * (see multiFlight.ts). All times are UTC instants; all durations are minutes.
 */

/** EASA primary pilot capacity — mutually exclusive, covers the whole flight. */
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
}

/** Fully derived column values, ready for storage / totals / PDF. */
export interface DerivedColumns {
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
}
