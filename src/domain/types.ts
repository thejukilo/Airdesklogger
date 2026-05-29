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

/** Balloon operational condition: a free flight or a tethered flight (BFCL.050). */
export type BalloonFlightType = "FREE" | "TETHERED";

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
  /** Hot-air balloon envelope-volume group ("A"/"B"/"C"/"D"); column 6 split. */
  balloonGroup?: string | undefined;
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
 * Refinements for some of the structured attributes (FOCA 2.2.3): the level of a
 * helicopter sling-load (HESLO) or human external cargo (HEC) operation and the
 * number of cycles, the gear used for a mountain landing, and the category of a
 * low-visibility landing.
 */
export interface AttributeDetails {
  // Legacy single-HESLO/HEC fields, kept for backward-compat with older entries.
  hesloLevel?: 1 | 2 | 3 | 4 | undefined;
  hecLevel?: 1 | 2 | undefined;
  hoistCycles?: number | undefined;
  lowVisibilityLandingType?: string | undefined;
  // Aeroplane / helicopter mountain landings: gear is aeroplane-only.
  mountainLandingGear?: "SKI" | "WHEELS" | undefined;
  mountainLandings?: number | undefined;
  mountainLandingsOfficial?: number | undefined;
  mountainLandingsAbove2000?: number | undefined;
  mountainLandingsAbove2700?: number | undefined;
  // Aeroplane manoeuvre counts.
  goArounds?: number | undefined;
  touchAndGo?: number | undefined;
  // Helicopter operations.
  hdfTakeoffs?: number | undefined;
  nvisMinutes?: number | undefined;
  heslo1Cycles?: number | undefined;
  heslo2Cycles?: number | undefined;
  heslo3Cycles?: number | undefined;
  heslo4Cycles?: number | undefined;
  hec1Cycles?: number | undefined;
  hec2Cycles?: number | undefined;
  hhoCycles?: number | undefined;
  // Sailplane / shared.
  aerobaticLevel?: "BASIC" | "ADVANCED" | undefined;
  // Comments on checks.
  skillTestComment?: string | undefined;
  proficiencyCheckComment?: string | undefined;
  licenceProficiencyCheckComment?: string | undefined;
  languageProficiencyComment?: string | undefined;
  aocComment?: string | undefined;
  demoFlightComment?: string | undefined;
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
  /** Free or tethered flight, when the aircraft is a balloon (BFCL.050). */
  balloonFlightType?: BalloonFlightType | undefined;
  /** Number of inflations, for a balloon (BFCL.050). */
  inflations?: number | undefined;
  /** Operating crew size: 2 (normal), or 3/4 for augmented operation (FOCA 2.3.4). */
  crewSize?: number;
  /**
   * Reduced loggable flight time, in minutes, for a series of flights recorded as
   * one entry. It may only lower the calculated block time, never raise it, and
   * is accepted only when the entry carries the series-of-flights attribute.
   */
  flightTimeMinutes?: number | undefined;
  /** Structured FOCA attributes (skill test, cross country, etc.). */
  attributes?: EntryAttribute[];
  /** Refinements for some attributes (HESLO/HEC level and cycles, etc.). */
  attributeDetails?: AttributeDetails | undefined;
  /** True when any time in the entry was supplied as local time (FOCA 2.2.7). */
  enteredInLocalTime?: boolean;
  /** True when the stored times are local (could not be converted to UTC), shown with an L. */
  timesLocal?: boolean | undefined;
  /** Aircraft hour-counter readings at block-off / block-on, in integer minutes since zero. Optional, import-only today. */
  counters?: Counters | undefined;
  /** Flight track as a GeoJSON LineString. Optional, import-only today. */
  track?: TrackLineString | undefined;
}

/**
 * Aircraft hour-counter readings carried in alongside block times. Stored as
 * integer minutes-since-zero (1392:38 -> 83558). Optional and import-only —
 * pilots don't enter these manually in the SPA. Shown on the entry-detail
 * page as hhh:mm; not part of the FOCA PDF.
 */
export interface Counters {
  ftcStart?: number | undefined;
  ftcEnd?: number | undefined;
  hobbsStart?: number | undefined;
  hobbsEnd?: number | undefined;
}

/**
 * Flight track as a GeoJSON LineString. Lon/lat pairs in WGS84, ordered by
 * recording time. Rendered as a small map on the entry-detail page when
 * present; not part of the FOCA PDF. Capped at 5000 points to keep payloads
 * sensible — high-rate trackers must downsample.
 */
export interface TrackLineString {
  type: "LineString";
  coordinates: ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;
}

/**
 * A synthetic training (FSTD) session, recorded on its own logbook row with the
 * flight columns left blank. Column 11 of AMC1 FCL.050. Total time of the
 * session includes pre- and after-flight checks. The exercise (for example a
 * proficiency check) goes in the remarks.
 */
export interface FstdSessionInput {
  pilotId: string;
  /** Aircraft model the simulator represents (e.g. "A320-200"). */
  deviceType: string;
  /** The device's EASA code (its identifier). */
  qualificationNumber: string;
  /** FSTD type/level (e.g. "FFS Level D", "FNPT II"). */
  qualification?: string | undefined;
  /** The pilot's capacity in the session. */
  pilotFunction?: "TRAINEE" | "SFI_SFE" | undefined;
  /** Whether the session was instruction received, and a short description. */
  instruction: string;
  date: Date; // UTC
  totalMinutes: number;
  /** Optional landings performed in the session. */
  landings?: { day: number; night: number } | undefined;
  remarks: string;
  attributes?: EntryAttribute[];
  enteredInLocalTime?: boolean;
}

/** Derived FSTD column values (column 11). */
export interface FstdColumns {
  date: string; // yyyy-mm-dd UTC
  deviceType: string;
  qualificationNumber: string;
  qualification?: string;
  pilotFunction?: string;
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
  /** Day/night segment pattern over the flight (e.g. "D-N-D"); blank if unknown. */
  dayNightPattern?: string;
  pic: number; // column 11a (incl. PICUS/SPIC)
  coPilot: number; // column 11b
  dual: number; // column 11c
  instructor: number; // column 11d
  isMultiFlight: boolean;
  /** Operating crew size; 3 or 4 means the logged times are a share (FOCA 2.3.4). */
  crewSize: number;
  /** Reduced flight time entered for a series of flights, when the pilot lowered it. */
  flightTimeMinutes?: number | undefined;
  /** Aircraft category for the entry (defaults to aeroplane). */
  category: AircraftCategory;
  /** Sailplane launch method, if recorded. */
  launchMethod?: LaunchMethod;
  /** Balloon free/tethered flight, if recorded. */
  balloonFlightType?: BalloonFlightType | undefined;
  /** Number of inflations, for a balloon. */
  inflations?: number | undefined;
  /** Total time credited to hot-air group A (minutes). For balloon entries only. */
  balloonGroupA?: number | undefined;
  balloonGroupB?: number | undefined;
  balloonGroupC?: number | undefined;
  balloonGroupD?: number | undefined;
  /** Total time credited to gas-balloon flying (minutes). */
  balloonGas?: number | undefined;
  /** Instructor/examiner seat position, if recorded. */
  instructorPosition?: InstructorPosition;
  /** Operating role, if recorded. */
  operatingRole?: OperatingRole;
  /** Present only when kind is FSTD (column 11 of the layout). */
  fstd?: FstdColumns;
  /** Structured FOCA attributes applied to the entry. */
  attributes: EntryAttribute[];
  /** Refinements for some attributes (HESLO/HEC level and cycles, etc.). */
  attributeDetails?: AttributeDetails | undefined;
  /** True when any time was entered as local time (flagged on exports). */
  enteredInLocalTime: boolean;
  /** True when the stored times are local (not UTC); shown with an L instead of Z. */
  timesLocal?: boolean | undefined;
  /** True when an attribute requires a sign-off that is not yet present. */
  signatureRequired: boolean;
  /** Aircraft hour-counter readings (integer minutes-since-zero). Shown on entry detail; not on the PDF. */
  counters?: Counters | undefined;
  /** Flight track. Shown on entry detail as a small map; not on the PDF. */
  track?: TrackLineString | undefined;
}
