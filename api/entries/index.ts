import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseEntryRequest, RequestError } from "../../src/http/parseEntry.js";
import { validateEntry } from "../../src/domain/validation.js";
import { createEntry, findOverlappingFlight, listEntriesForPilot } from "../../src/db/repository.js";
import { validateFlightReferences } from "../../src/http/validateReferences.js";
import { getAirportCoords } from "../../src/db/referenceRepository.js";
import { nightMinutes } from "../../src/domain/night.js";
import { zonedWallClockToUtc, LocalTimeError } from "../../src/domain/localTime.js";
import { toUtcIso } from "../../src/domain/time.js";
import { timezoneAt } from "../../src/http/timezone.js";
import { requireUser, AuthError } from "../../src/http/auth.js";

/**
 * The logbook collection for the signed-in holder.
 *   GET  lists the holder's own entries.
 *   POST records a new entry. The holder id always comes from the session, never
 *        the request body, so a pilot can only write to their own logbook.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const claims = await requireUser(req);

    if (req.method === "GET") {
      res.status(200).json({ entries: await listEntriesForPilot(claims.sub) });
      return;
    }

    if (req.method === "POST") {
      const raw = typeof req.body === "string" ? safeJson(req.body) : req.body;
      // Local block times are interpreted at the aerodrome, not on the device:
      // convert them to UTC using each airport's own timezone before parsing.
      const localMode = (raw as { timeZone?: unknown })?.timeZone === "LOCAL";
      const body = localMode ? { ...(raw as object), legs: await legsLocalToUtc(raw) } : raw;
      const input = parseEntryRequest({ ...(body as object), pilotId: claims.sub });
      if (localMode) input.enteredInLocalTime = true;
      // A flight cannot be logged before it has happened. Guards against a date
      // or block time accidentally set in the future.
      const latestArrival = Math.max(...input.legs.map((l) => l.arrivalTime.getTime()));
      if (latestArrival > Date.now() + 60_000) {
        res.status(422).json({
          valid: false,
          issues: [{ field: "legs", message: "A flight cannot be logged with a date or time in the future." }],
        });
        return;
      }
      // Night time is computed, not taken from the client (FOCA 2.3.4). It is the
      // part of each leg that falls in night at the departure aerodrome.
      input.conditions.night = await computeNight(input);
      const result = validateEntry(input);
      if (!result.valid || !result.derived) {
        res.status(422).json({ valid: false, issues: result.issues });
        return;
      }
      const refIssues = await validateFlightReferences(input);
      if (refIssues.length > 0) {
        res.status(422).json({ valid: false, issues: refIssues });
        return;
      }
      // A pilot cannot be on two flights at once: reject a new entry whose time
      // window overlaps an existing flight for this holder.
      const startIso = new Date(Math.min(...input.legs.map((l) => l.departureTime.getTime()))).toISOString();
      const endIso = new Date(Math.max(...input.legs.map((l) => l.arrivalTime.getTime()))).toISOString();
      const clashDate = await findOverlappingFlight(claims.sub, startIso, endIso);
      if (clashDate) {
        res.status(422).json({
          valid: false,
          issues: [{ field: "legs", message: `This flight overlaps an existing entry on ${clashDate}. A pilot cannot be on two flights at the same time.` }],
        });
        return;
      }
      const created = await createEntry(input, result.derived, claims.sub);
      res.status(201).json(created);
      return;
    }

    res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** The IANA timezone of an aerodrome, from its stored coordinates. */
async function timezoneForPlace(icao: string): Promise<string | null> {
  const coords = await getAirportCoords(icao);
  return coords ? timezoneAt(coords.latitude, coords.longitude) : null;
}

interface RawLeg {
  departurePlace: string;
  arrivalPlace: string;
  departureTime: string;
  arrivalTime: string;
  [k: string]: unknown;
}

/**
 * Convert a request's local block times to UTC using each end's aerodrome
 * timezone. Departure is converted in the departure airport's zone, arrival in
 * the arrival airport's zone. A place with no known timezone (no coordinates, or
 * the ZZZZ indicator) cannot be converted, so the request is refused.
 */
async function legsLocalToUtc(raw: unknown): Promise<RawLeg[]> {
  const legs = Array.isArray((raw as { legs?: unknown })?.legs) ? ((raw as { legs: RawLeg[] }).legs) : [];
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

/** Sum of night minutes across the legs, using each departure aerodrome. */
async function computeNight(input: Parameters<typeof validateEntry>[0]): Promise<number> {
  let total = 0;
  for (const leg of input.legs) {
    const coords = await getAirportCoords(leg.departurePlace);
    total += nightMinutes(leg.departureTime, leg.arrivalTime, coords);
  }
  return total;
}
