/**
 * Derive the 12 column values from an authored entry and enforce the
 * cross-column invariants EASA relies on:
 *   - total time = sum of leg block times;
 *   - single-pilot SE + single-pilot ME + multi-pilot time = total (col 5+6 = 7);
 *   - function times PIC + co-pilot + dual = total (the primary capacity covers
 *     the whole flight);
 *   - night / IFR / instructor time never exceed the total;
 *   - landing counts are non-negative integers.
 */

import type { DerivedColumns, FlightEntryInput, FstdSessionInput } from "./types.js";
import { minutesBetween, utcDateKey } from "./time.js";
import { validateMultiFlight } from "./multiFlight.js";
import { functionMinutes } from "./functionTime.js";
import { isEntryAttribute, requiresSignature, type EntryAttribute } from "./attributes.js";

function validateAttributes(attributes: EntryAttribute[] | undefined, issues: ValidationIssue[]): EntryAttribute[] {
  const attrs = attributes ?? [];
  for (const a of attrs) {
    if (!isEntryAttribute(a)) {
      issues.push({ field: "attributes", message: `Unknown attribute "${a}".` });
    }
  }
  return attrs.filter(isEntryAttribute);
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  derived?: DerivedColumns;
}

function isNonNegInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function validateEntry(input: FlightEntryInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  const mf = validateMultiFlight(input.legs);
  for (const v of mf.violations) {
    issues.push({ field: `legs[${v.legIndex ?? "*"}]`, message: v.message });
  }
  if (input.legs.length === 0) {
    return { valid: false, issues };
  }

  const first = input.legs[0]!;
  const last = input.legs[input.legs.length - 1]!;
  const total = input.legs.reduce(
    (acc, leg) => acc + Math.max(0, minutesBetween(leg.departureTime, leg.arrivalTime)),
    0,
  );

  // Columns 5 & 6: single-pilot SE/ME vs multi-pilot, exhaustively from total.
  const multiPilot = input.aircraft.multiPilot ? total : 0;
  const singleEngine =
    !input.aircraft.multiPilot && input.aircraft.engineClass === "SE" ? total : 0;
  const multiEngine =
    !input.aircraft.multiPilot && input.aircraft.engineClass === "ME" ? total : 0;

  if (singleEngine + multiEngine + multiPilot !== total) {
    issues.push({
      field: "totalTime",
      message: "Single-pilot SE + ME + multi-pilot time must equal total time of flight.",
    });
  }

  // Column 10.
  if (!isNonNegInt(input.conditions.night) || input.conditions.night > total) {
    issues.push({ field: "conditions.night", message: "Night time must be 0..total." });
  }
  if (!isNonNegInt(input.conditions.ifr) || input.conditions.ifr > total) {
    issues.push({ field: "conditions.ifr", message: "IFR time must be 0..total." });
  }

  // Column 9.
  if (!isNonNegInt(input.landings.day)) {
    issues.push({ field: "landings.day", message: "Day landings must be a non-negative integer." });
  }
  if (!isNonNegInt(input.landings.night)) {
    issues.push({
      field: "landings.night",
      message: "Night landings must be a non-negative integer.",
    });
  }

  // Column 11.
  const fm = functionMinutes(input.function, total);
  if (fm.pic + fm.coPilot + fm.dual !== total) {
    issues.push({
      field: "function.primary",
      message: "PIC + co-pilot + dual time must equal total time of flight.",
    });
  }
  if (!isNonNegInt(input.function.instructor) || input.function.instructor > total) {
    issues.push({ field: "function.instructor", message: "Instructor time must be 0..total." });
  }

  if (!input.picName || input.picName.trim() === "") {
    issues.push({ field: "picName", message: "Name of PIC is required (use SELF if applicable)." });
  }

  const attributes = validateAttributes(input.attributes, issues);

  if (issues.length > 0) return { valid: false, issues };

  const derived: DerivedColumns = {
    kind: "FLIGHT",
    attributes,
    enteredInLocalTime: input.enteredInLocalTime ?? false,
    signatureRequired: requiresSignature(attributes),
    date: utcDateKey(first.departureTime),
    departurePlace: first.departurePlace,
    departureTime: first.departureTime,
    arrivalPlace: last.arrivalPlace,
    arrivalTime: last.arrivalTime,
    singleEngine,
    multiEngine,
    multiPilot,
    total,
    dayLandings: input.landings.day,
    nightLandings: input.landings.night,
    night: input.conditions.night,
    ifr: input.conditions.ifr,
    pic: fm.pic,
    coPilot: fm.coPilot,
    dual: fm.dual,
    instructor: fm.instructor,
    isMultiFlight: mf.isMultiFlight,
  };

  return { valid: true, issues: [], derived };
}

/**
 * Validate a synthetic training session. An FSTD row carries no flight time; the
 * flight columns are all zero and only the FSTD column and remarks are filled.
 */
export function validateFstdSession(input: FstdSessionInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!input.deviceType.trim()) {
    issues.push({ field: "deviceType", message: "Device type is required (aircraft type, or FNPT I/II)." });
  }
  if (!input.qualificationNumber.trim()) {
    issues.push({ field: "qualificationNumber", message: "Device qualification number is required." });
  }
  if (!isNonNegInt(input.totalMinutes) || input.totalMinutes === 0) {
    issues.push({ field: "totalMinutes", message: "Total time of session must be a positive whole number of minutes." });
  }
  if (Number.isNaN(input.date.getTime())) {
    issues.push({ field: "date", message: "A valid session date is required." });
  }
  const attributes = validateAttributes(input.attributes, issues);

  if (issues.length > 0) return { valid: false, issues };

  const date = utcDateKey(input.date);
  const derived: DerivedColumns = {
    kind: "FSTD",
    attributes,
    enteredInLocalTime: input.enteredInLocalTime ?? false,
    signatureRequired: requiresSignature(attributes),
    date,
    departurePlace: "",
    departureTime: input.date,
    arrivalPlace: "",
    arrivalTime: input.date,
    singleEngine: 0,
    multiEngine: 0,
    multiPilot: 0,
    total: 0,
    dayLandings: 0,
    nightLandings: 0,
    night: 0,
    ifr: 0,
    pic: 0,
    coPilot: 0,
    dual: 0,
    instructor: 0,
    isMultiFlight: false,
    fstd: {
      date,
      deviceType: input.deviceType,
      qualificationNumber: input.qualificationNumber,
      instruction: input.instruction,
      totalMinutes: input.totalMinutes,
    },
  };
  return { valid: true, issues: [], derived };
}
