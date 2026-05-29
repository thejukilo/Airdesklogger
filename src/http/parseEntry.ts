/**
 * Turns an HTTP request body into a validated FlightEntryInput.
 *
 * This is the boundary where untrusted input enters the system, so it is also
 * where UTC is enforced. The shape is checked first, then each leg time is
 * parsed with parseUtcInstant, which rejects any value that is not expressed in
 * UTC. A bad shape or a non-UTC time produces a RequestError that the handlers
 * turn into a 400 response.
 */

import { z } from "zod";
import { parseInstant, AmbiguousTimeError } from "../domain/time.js";
import type { FlightEntryInput } from "../domain/types.js";
import type { EntryAttribute } from "../domain/attributes.js";

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

const LegShape = z.object({
  departurePlace: z.string().min(1),
  departureTime: z.string(),
  arrivalPlace: z.string().min(1),
  arrivalTime: z.string(),
  departurePlaceName: z.string().optional(),
  arrivalPlaceName: z.string().optional(),
});

const EntryShape = z.object({
  pilotId: z.string().min(1),
  aircraft: z.object({
    makeModelVariant: z.string().min(1),
    registration: z.string().min(1),
    engineClass: z.enum(["SE", "ME"]),
    multiPilot: z.boolean(),
    category: z.enum(["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"]).optional(),
    /** Balloon envelope-volume group (A/B/C/D); kept on the entry verbatim. */
    balloonGroup: z.string().optional(),
  }),
  legs: z.array(LegShape).min(1),
  picName: z.string(),
  landings: z.object({
    day: z.number().int().nonnegative(),
    night: z.number().int().nonnegative(),
  }),
  conditions: z.object({
    night: z.number().int().nonnegative(),
    ifr: z.number().int().nonnegative(),
  }),
  function: z.object({
    primary: z.enum(["PIC", "PICUS", "SPIC", "CO_PILOT", "DUAL", "SAFETY_PILOT"]),
    instructor: z.number().int().nonnegative(),
    instructorPosition: z.enum(["PILOT_SEAT", "JUMP_SEAT", "SUPERVISING", "EXAMINER"]).optional(),
    tookControl: z.boolean().optional(),
  }),
  remarks: z.string(),
  operatingRole: z.enum(["PILOT_FLYING", "PILOT_MONITORING"]).optional(),
  launchMethod: z.enum(["WINCH", "AEROTOW", "SELF_LAUNCH", "BUNGEE", "CAR_TOW"]).optional(),
  balloonFlightType: z.enum(["FREE", "TETHERED"]).optional(),
  inflations: z.number().int().nonnegative().optional(),
  crewSize: z.number().int().optional(),
  flightTimeMinutes: z.number().int().positive().optional(),
  attributes: z.array(z.string()).optional(),
  attributeDetails: z
    .object({
      // Legacy fields.
      hesloLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
      hecLevel: z.union([z.literal(1), z.literal(2)]).optional(),
      hoistCycles: z.number().int().nonnegative().optional(),
      lowVisibilityLandingType: z.string().optional(),
      // Mountain landings.
      mountainLandingGear: z.enum(["SKI", "WHEELS"]).optional(),
      mountainLandings: z.number().int().nonnegative().optional(),
      mountainLandingsOfficial: z.number().int().nonnegative().optional(),
      mountainLandingsAbove2000: z.number().int().nonnegative().optional(),
      mountainLandingsAbove2700: z.number().int().nonnegative().optional(),
      // Aeroplane manoeuvre counts.
      goArounds: z.number().int().nonnegative().optional(),
      touchAndGo: z.number().int().nonnegative().optional(),
      // Helicopter operations.
      hdfTakeoffs: z.number().int().nonnegative().optional(),
      nvisMinutes: z.number().int().nonnegative().optional(),
      heslo1Cycles: z.number().int().nonnegative().optional(),
      heslo2Cycles: z.number().int().nonnegative().optional(),
      heslo3Cycles: z.number().int().nonnegative().optional(),
      heslo4Cycles: z.number().int().nonnegative().optional(),
      hec1Cycles: z.number().int().nonnegative().optional(),
      hec2Cycles: z.number().int().nonnegative().optional(),
      hhoCycles: z.number().int().nonnegative().optional(),
      aerobaticLevel: z.enum(["BASIC", "ADVANCED"]).optional(),
      // Comments on checks.
      skillTestComment: z.string().optional(),
      proficiencyCheckComment: z.string().optional(),
      licenceProficiencyCheckComment: z.string().optional(),
      languageProficiencyComment: z.string().optional(),
      aocComment: z.string().optional(),
      demoFlightComment: z.string().optional(),
    })
    .optional(),
  counters: z
    .object({
      ftcStart: z.union([z.number().int().nonnegative(), z.string()]).optional(),
      ftcEnd: z.union([z.number().int().nonnegative(), z.string()]).optional(),
      hobbsStart: z.union([z.number().int().nonnegative(), z.string()]).optional(),
      hobbsEnd: z.union([z.number().int().nonnegative(), z.string()]).optional(),
    })
    .optional(),
});

/**
 * Counter values come in as either an integer (minutes-since-zero, e.g. 83558
 * for 1392:38) or as the matching "hhh:mm" string. Normalise to integer
 * minutes; reject malformed strings with a clear message.
 */
function counterToMinutes(field: string, v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return Math.round(v);
  const s = v.trim();
  const hhmm = /^(\d{1,5}):([0-5]\d)$/.exec(s);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  if (/^\d+$/.test(s)) return Number(s);
  throw new RequestError(`Counter "${field}" must be an integer (minutes) or a "hhh:mm" string; got "${v}".`);
}

/** Vercel parses a JSON body into an object, but a raw string can also arrive. */
function asObject(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new RequestError("Request body is not valid JSON.");
    }
  }
  return body;
}

export function parseEntryRequest(body: unknown): FlightEntryInput {
  const parsed = EntryShape.safeParse(asObject(body));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.join(".") || "body" : "body";
    throw new RequestError(`Invalid ${where}: ${first ? first.message : "unknown error"}`);
  }
  const data = parsed.data;

  try {
    let enteredLocal = false;
    const legs = data.legs.map((l) => {
      const dep = parseInstant(l.departureTime);
      const arr = parseInstant(l.arrivalTime);
      if (dep.enteredLocal || arr.enteredLocal) enteredLocal = true;
      return {
        departurePlace: l.departurePlace,
        departureTime: dep.utc,
        arrivalPlace: l.arrivalPlace,
        arrivalTime: arr.utc,
        ...(l.departurePlaceName !== undefined ? { departurePlaceName: l.departurePlaceName } : {}),
        ...(l.arrivalPlaceName !== undefined ? { arrivalPlaceName: l.arrivalPlaceName } : {}),
      };
    });
    return {
      pilotId: data.pilotId,
      aircraft: data.aircraft,
      legs,
      picName: data.picName,
      landings: data.landings,
      conditions: data.conditions,
      function: data.function,
      remarks: data.remarks,
      ...(data.operatingRole !== undefined ? { operatingRole: data.operatingRole } : {}),
      ...(data.launchMethod !== undefined ? { launchMethod: data.launchMethod } : {}),
      ...(data.balloonFlightType !== undefined ? { balloonFlightType: data.balloonFlightType } : {}),
      ...(data.inflations !== undefined ? { inflations: data.inflations } : {}),
      ...(data.crewSize !== undefined ? { crewSize: data.crewSize } : {}),
      ...(data.flightTimeMinutes !== undefined ? { flightTimeMinutes: data.flightTimeMinutes } : {}),
      attributes: (data.attributes ?? []) as EntryAttribute[],
      ...(data.attributeDetails !== undefined ? { attributeDetails: data.attributeDetails } : {}),
      ...(data.counters
        ? (() => {
            const c = {
              ...(data.counters.ftcStart   !== undefined ? { ftcStart:   counterToMinutes("ftcStart",   data.counters.ftcStart)   } : {}),
              ...(data.counters.ftcEnd     !== undefined ? { ftcEnd:     counterToMinutes("ftcEnd",     data.counters.ftcEnd)     } : {}),
              ...(data.counters.hobbsStart !== undefined ? { hobbsStart: counterToMinutes("hobbsStart", data.counters.hobbsStart) } : {}),
              ...(data.counters.hobbsEnd   !== undefined ? { hobbsEnd:   counterToMinutes("hobbsEnd",   data.counters.hobbsEnd)   } : {}),
            };
            return Object.keys(c).length > 0 ? { counters: c } : {};
          })()
        : {}),
      enteredInLocalTime: enteredLocal,
    };
  } catch (err) {
    if (err instanceof AmbiguousTimeError) throw new RequestError(err.message);
    throw err;
  }
}
