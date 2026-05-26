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

import type { AircraftCategory, AttributeDetails, DerivedColumns, FlightEntryInput, FstdSessionInput, PilotFunction } from "./types.js";
import { minutesBetween, utcDateKey } from "./time.js";
import { validateMultiFlight } from "./multiFlight.js";
import { functionMinutes } from "./functionTime.js";
import { isValidCrewSize, loggedMinutes } from "./crew.js";
import { ATTRIBUTE_CATEGORY_RESTRICTIONS, isEntryAttribute, requiresSignature, type EntryAttribute } from "./attributes.js";
import { isNoLocationIndicator } from "./icao.js";

function validateAttributes(
  attributes: EntryAttribute[] | undefined,
  issues: ValidationIssue[],
  category?: AircraftCategory,
): EntryAttribute[] {
  const attrs = attributes ?? [];
  for (const a of attrs) {
    if (!isEntryAttribute(a)) {
      issues.push({ field: "attributes", message: `Unknown attribute "${a}".` });
      continue;
    }
    const allowed = ATTRIBUTE_CATEGORY_RESTRICTIONS[a];
    if (category && allowed && !allowed.includes(category)) {
      issues.push({
        field: "attributes",
        message: `"${a}" applies only to ${allowed.map((c) => c.toLowerCase()).join(" or ")} flights.`,
      });
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

/** Keep only the attribute refinements that are actually set and well-formed. */
function cleanAttributeDetails(
  d: AttributeDetails | undefined,
  issues: ValidationIssue[],
): AttributeDetails | undefined {
  if (!d) return undefined;
  const out: AttributeDetails = {};
  if (d.hesloLevel !== undefined) out.hesloLevel = d.hesloLevel;
  if (d.hecLevel !== undefined) out.hecLevel = d.hecLevel;
  if (d.mountainLandingGear !== undefined) out.mountainLandingGear = d.mountainLandingGear;
  if (d.lowVisibilityLandingType !== undefined && d.lowVisibilityLandingType.trim() !== "") {
    out.lowVisibilityLandingType = d.lowVisibilityLandingType.trim();
  }
  if (d.hoistCycles !== undefined) {
    if (!isNonNegInt(d.hoistCycles)) {
      issues.push({ field: "attributeDetails.hoistCycles", message: "Number of cycles must be a non-negative integer." });
    } else if (d.hoistCycles > 0) {
      out.hoistCycles = d.hoistCycles;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  // Block time is the real time aloft; the logged time may be a crew share of it.
  const blockTime = input.legs.reduce(
    (acc, leg) => acc + Math.max(0, minutesBetween(leg.departureTime, leg.arrivalTime)),
    0,
  );

  const crewSize = input.crewSize ?? 2;
  if (!isValidCrewSize(crewSize)) {
    issues.push({ field: "crewSize", message: "Crew size must be 2, 3 or 4." });
  }
  if (crewSize > 2 && !input.aircraft.multiPilot) {
    issues.push({
      field: "crewSize",
      message: "Augmented crew (3 or 4 pilots) applies only to multi-pilot operations.",
    });
  }

  // Conditions and instructor time are validated against actual block time,
  // before the crew share is applied.
  if (!isNonNegInt(input.conditions.night) || input.conditions.night > blockTime) {
    issues.push({ field: "conditions.night", message: "Night time must be 0..block time." });
  }
  if (!isNonNegInt(input.conditions.ifr) || input.conditions.ifr > blockTime) {
    issues.push({ field: "conditions.ifr", message: "IFR time must be 0..block time." });
  }
  if (!isNonNegInt(input.function.instructor) || input.function.instructor > blockTime) {
    issues.push({ field: "function.instructor", message: "Instructor time must be 0..block time." });
  }

  // Jump-seat rule (FOCA 2.2.4 and Logging of Flight Time 2.3.2): time on the
  // jump seat cannot be logged as PIC or instructor time.
  if (input.function.instructorPosition === "JUMP_SEAT") {
    if (input.function.instructor > 0) {
      issues.push({ field: "function.instructor", message: "Instructor time cannot be logged from the jump seat." });
    }
    if (input.function.primary === "PIC" || input.function.primary === "PICUS" || input.function.primary === "SPIC") {
      issues.push({ field: "function.primary", message: "PIC time cannot be logged from the jump seat." });
    }
  }

  // Sailplane launch method only applies to sailplanes (FOCA 2.2.5).
  const category = input.aircraft.category ?? "AEROPLANE";
  if (input.launchMethod !== undefined && category !== "SAILPLANE") {
    issues.push({ field: "launchMethod", message: "Launch method applies only to sailplanes." });
  }
  // Free/tethered and the inflation count are balloon-only (BFCL.050).
  if (input.balloonFlightType !== undefined && category !== "BALLOON") {
    issues.push({ field: "balloonFlightType", message: "Free/tethered applies only to balloons." });
  }
  if (input.inflations !== undefined) {
    if (category !== "BALLOON") {
      issues.push({ field: "inflations", message: "Number of inflations applies only to balloons." });
    } else if (!isNonNegInt(input.inflations)) {
      issues.push({ field: "inflations", message: "Number of inflations must be a non-negative integer." });
    }
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

  if (!input.picName || input.picName.trim() === "") {
    issues.push({ field: "picName", message: "Name of PIC is required (use SELF if applicable)." });
  }

  // On a dual flight the trainee is not the pilot in command, so the PIC is the
  // instructor: SELF (or a blank) is not acceptable, a real name is required.
  if (input.function.primary === "DUAL") {
    const pic = (input.picName ?? "").trim();
    if (pic === "" || pic.toUpperCase() === "SELF") {
      issues.push({
        field: "picName",
        message: "On a dual flight the pilot in command is the instructor; enter the instructor's name, not SELF.",
      });
    }
  }

  // FOCA 2.3.3: when the place is the ZZZZ no-location indicator, the name of the
  // aerodrome or place has to be given in free text.
  input.legs.forEach((leg, i) => {
    if (isNoLocationIndicator(leg.departurePlace) && !leg.departurePlaceName?.trim()) {
      issues.push({ field: `legs[${i}].departurePlaceName`, message: "Name the departure place when using ZZZZ." });
    }
    if (isNoLocationIndicator(leg.arrivalPlace) && !leg.arrivalPlaceName?.trim()) {
      issues.push({ field: `legs[${i}].arrivalPlaceName`, message: "Name the arrival place when using ZZZZ." });
    }
  });

  const attributes = validateAttributes(input.attributes, issues, category);
  const attributeDetails = cleanAttributeDetails(input.attributeDetails, issues);

  // A series of flights may be recorded as one entry with a reduced total: the
  // pilot may lower the calculated block time but never raise it, and only when
  // the entry is marked as a series of flights.
  let effectiveBlock = blockTime;
  if (input.flightTimeMinutes !== undefined) {
    if (!attributes.includes("series_of_flights")) {
      issues.push({ field: "flightTimeMinutes", message: "A reduced flight time can only be entered for a series of flights." });
    } else if (!isNonNegInt(input.flightTimeMinutes) || input.flightTimeMinutes < 1) {
      issues.push({ field: "flightTimeMinutes", message: "Flight time must be a positive whole number of minutes." });
    } else if (input.flightTimeMinutes > blockTime) {
      issues.push({ field: "flightTimeMinutes", message: "The flight time of a series may only be reduced, not raised above the calculated time." });
    } else {
      effectiveBlock = input.flightTimeMinutes;
    }
  }

  if (issues.length > 0) return { valid: false, issues };

  // Apply the crew share to every category of time (FOCA 2.3.4). Landings are
  // counts, not time, and are never scaled.
  const safeCrew = crewSize as 2 | 3 | 4;

  // A safety pilot logs flight time only if they took control (FOCA 2.3.5), and
  // that time is logged in command. Otherwise the flight is recorded with no
  // creditable time at all.
  const isSafety = input.function.primary === "SAFETY_PILOT";
  const safetyNoControl = isSafety && !input.function.tookControl;
  const effectivePrimary: PilotFunction = isSafety
    ? input.function.tookControl
      ? "PIC"
      : "SAFETY_PILOT"
    : input.function.primary;

  const total = safetyNoControl ? 0 : loggedMinutes(effectiveBlock, safeCrew);

  // Columns 5 & 6: single-pilot SE/ME vs multi-pilot, exhaustively from the
  // logged total. These aeroplane/helicopter columns are left blank for balloons
  // and sailplanes, whose time sits in the total column only.
  const poweredAircraft = category === "AEROPLANE" || category === "HELICOPTER";
  const multiPilot = poweredAircraft && input.aircraft.multiPilot ? total : 0;
  const singleEngine =
    poweredAircraft && !input.aircraft.multiPilot && input.aircraft.engineClass === "SE" ? total : 0;
  const multiEngine =
    poweredAircraft && !input.aircraft.multiPilot && input.aircraft.engineClass === "ME" ? total : 0;

  // Night, IFR and instructor time are portions of the flight, so a reduced
  // series total caps them too (they are computed against the full block).
  const night = safetyNoControl ? 0 : loggedMinutes(Math.min(input.conditions.night, effectiveBlock), safeCrew);
  const ifr = safetyNoControl ? 0 : loggedMinutes(Math.min(input.conditions.ifr, effectiveBlock), safeCrew);

  // Column 11.
  const instructorMinutes = Math.min(input.function.instructor, effectiveBlock);
  const fm = functionMinutes({ primary: effectivePrimary, instructor: instructorMinutes }, total);
  const instructor = safetyNoControl ? 0 : loggedMinutes(instructorMinutes, safeCrew);

  const derived: DerivedColumns = {
    kind: "FLIGHT",
    attributes,
    ...(attributeDetails !== undefined ? { attributeDetails } : {}),
    enteredInLocalTime: input.enteredInLocalTime ?? false,
    ...(input.timesLocal ? { timesLocal: true } : {}),
    signatureRequired: requiresSignature(attributes),
    crewSize,
    category,
    ...(input.launchMethod !== undefined ? { launchMethod: input.launchMethod } : {}),
    ...(input.balloonFlightType !== undefined ? { balloonFlightType: input.balloonFlightType } : {}),
    ...(input.inflations !== undefined ? { inflations: input.inflations } : {}),
    ...(input.flightTimeMinutes !== undefined ? { flightTimeMinutes: input.flightTimeMinutes } : {}),
    ...(input.function.instructorPosition !== undefined ? { instructorPosition: input.function.instructorPosition } : {}),
    ...(input.operatingRole !== undefined ? { operatingRole: input.operatingRole } : {}),
    date: utcDateKey(first.departureTime),
    departurePlace: first.departurePlace,
    departureTime: first.departureTime,
    arrivalPlace: last.arrivalPlace,
    arrivalTime: last.arrivalTime,
    ...(first.departurePlaceName !== undefined ? { departurePlaceName: first.departurePlaceName } : {}),
    ...(last.arrivalPlaceName !== undefined ? { arrivalPlaceName: last.arrivalPlaceName } : {}),
    singleEngine,
    multiEngine,
    multiPilot,
    total,
    dayLandings: input.landings.day,
    nightLandings: input.landings.night,
    night,
    ifr,
    pic: fm.pic,
    coPilot: fm.coPilot,
    dual: fm.dual,
    instructor,
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
    crewSize: 2,
    category: "AEROPLANE",
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
