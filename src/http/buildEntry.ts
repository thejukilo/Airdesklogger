/**
 * Shared preparation for a flight entry, used by both create (POST) and amend
 * (PATCH) so an edited entry goes through exactly the same rules as a new one:
 * local-time conversion against the aerodrome timezone, automatic night time and
 * day/night landing classification, the no-future-date guard, reference checks,
 * the overlap guard, and the cross-column validation.
 */

import { parseEntryRequest, RequestError } from "./parseEntry.js";
import { validateEntry } from "../domain/validation.js";
import { validateFlightReferences } from "./validateReferences.js";
import { getAirportCoords } from "../db/referenceRepository.js";
import { findOverlappingFlight } from "../db/repository.js";
import { nightMinutes, isNightAt } from "../domain/night.js";
import { zonedWallClockToUtc, LocalTimeError } from "../domain/localTime.js";
import { toUtcIso } from "../domain/time.js";
import { timezoneAt } from "./timezone.js";
import type { DerivedColumns, FlightEntryInput } from "../domain/types.js";

export type PreparedEntry =
  | { ok: true; input: FlightEntryInput; derived: DerivedColumns }
  | { ok: false; status: number; body: unknown };

interface RawLeg {
  departurePlace: string;
  arrivalPlace: string;
  departureTime: string;
  arrivalTime: string;
  [k: string]: unknown;
}

async function timezoneForPlace(icao: string): Promise<string | null> {
  const coords = await getAirportCoords(icao);
  return coords ? timezoneAt(coords.latitude, coords.longitude) : null;
}

async function legsLocalToUtc(raw: unknown): Promise<RawLeg[]> {
  const legs = Array.isArray((raw as { legs?: unknown })?.legs) ? (raw as { legs: RawLeg[] }).legs : [];
  return Promise.all(
    legs.map(async (leg) => {
      const depTz = await timezoneForPlace(String(leg.departurePlace).toUpperCase());
      const arrTz = await timezoneForPlace(String(leg.arrivalPlace).toUpperCase());
      if (!depTz || !arrTz) {
        throw new RequestError(
          "Local time could not be converted because an aerodrome has no position on file yet. Switch this entry to UTC, or ask an administrator to refresh the airport data.",
        );
      }
      try {
        return {
          ...leg,
          departureTime: toUtcIso(zonedWallClockToUtc(String(leg.departureTime), depTz)),
          arrivalTime: toUtcIso(zonedWallClockToUtc(String(leg.arrivalTime), arrTz)),
        };
      } catch (err) {
        if (err instanceof LocalTimeError) throw new RequestError(err.message);
        throw err;
      }
    }),
  );
}

async function computeNight(input: FlightEntryInput): Promise<number> {
  let total = 0;
  for (const leg of input.legs) {
    const coords = await getAirportCoords(leg.departurePlace);
    total += nightMinutes(leg.departureTime, leg.arrivalTime, coords);
  }
  return total;
}

async function classifyLandings(input: FlightEntryInput): Promise<{ day: number; night: number }> {
  const total = (input.landings.day || 0) + (input.landings.night || 0);
  if (total === 0) return { day: 0, night: 0 };
  const lastLeg = input.legs[input.legs.length - 1]!;
  const coords = await getAirportCoords(lastLeg.arrivalPlace);
  return isNightAt(lastLeg.arrivalTime, coords) ? { day: 0, night: total } : { day: total, night: 0 };
}

/**
 * Validate and enrich a raw request body into a stored-ready entry. The holder id
 * always comes from the session. `excludeEntryId` is the entry being amended, so
 * it does not count as an overlap against itself. Throws RequestError on a bad
 * body or an unconvertible local time (the caller maps that to a 400).
 */
export async function prepareFlightEntry(
  raw: unknown,
  pilotId: string,
  opts: { excludeEntryId?: string } = {},
): Promise<PreparedEntry> {
  const localMode = (raw as { timeZone?: unknown })?.timeZone === "LOCAL";
  const body = localMode ? { ...(raw as object), legs: await legsLocalToUtc(raw) } : raw;
  const input = parseEntryRequest({ ...(body as object), pilotId });
  if (localMode) input.enteredInLocalTime = true;

  const latestArrival = Math.max(...input.legs.map((l) => l.arrivalTime.getTime()));
  if (latestArrival > Date.now() + 60_000) {
    return { ok: false, status: 422, body: { valid: false, issues: [{ field: "legs", message: "A flight cannot be logged with a date or time in the future." }] } };
  }

  input.conditions.night = await computeNight(input);
  input.landings = await classifyLandings(input);

  const result = validateEntry(input);
  if (!result.valid || !result.derived) {
    return { ok: false, status: 422, body: { valid: false, issues: result.issues } };
  }

  const refIssues = await validateFlightReferences(input);
  if (refIssues.length > 0) {
    return { ok: false, status: 422, body: { valid: false, issues: refIssues } };
  }

  const startIso = new Date(Math.min(...input.legs.map((l) => l.departureTime.getTime()))).toISOString();
  const endIso = new Date(Math.max(...input.legs.map((l) => l.arrivalTime.getTime()))).toISOString();
  const clashDate = await findOverlappingFlight(pilotId, startIso, endIso, opts.excludeEntryId);
  if (clashDate) {
    return { ok: false, status: 422, body: { valid: false, issues: [{ field: "legs", message: `This flight overlaps an existing entry on ${clashDate}. A pilot cannot be on two flights at the same time.` }] } };
  }

  return { ok: true, input, derived: result.derived };
}
