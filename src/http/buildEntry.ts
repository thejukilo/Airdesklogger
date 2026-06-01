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
import { nightMinutes, isNightAt, dayNightPattern } from "../domain/night.js";
import { zonedWallClockToUtc, zonedUtcToWallClock, LocalTimeError } from "../domain/localTime.js";
import { toUtcIso } from "../domain/time.js";
import { timezoneAt } from "./timezone.js";
import type { DerivedColumns, FlightEntryInput } from "../domain/types.js";

/**
 * Per-token preferences carried in from the Import API. The same prepare
 * function services both the SPA (no token, all defaults) and the import path
 * (token-bound defaults that the body can override case-by-case).
 */
export interface ImportPrefs {
  /** What time zone the importer's leg times are expressed in. */
  sourceTimeZone: "UTC" | "LOCAL";
  /** Whether we store/display in UTC or in local wall-clock. */
  storeTimeZone: "UTC" | "LOCAL";
  /** When the importer marks an aircraft as TMG, which column the hours land in. */
  tmgCategory: "AEROPLANE" | "SAILPLANE";
}

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

/** A wall-clock string kept as-is, marked as a UTC-shaped instant for storage. */
function asInstantString(wallClock: unknown): string {
  const s = String(wallClock);
  return /(Z|[+-]\d{2}:\d{2})$/.test(s) ? s : `${s}Z`;
}

async function tzCacheFor(legs: RawLeg[]): Promise<Map<string, string | null>> {
  const cache = new Map<string, string | null>();
  for (const leg of legs) {
    for (const place of [leg.departurePlace, leg.arrivalPlace]) {
      const key = String(place).toUpperCase();
      if (!cache.has(key)) cache.set(key, await timezoneForPlace(key));
    }
  }
  return cache;
}

/**
 * Convert a local-time request to UTC against each aerodrome's timezone. When a
 * place has no timezone on file (no coordinates), the time cannot be converted,
 * so it is kept as local and the entry is flagged `timesLocal` (shown with an L
 * instead of a Z) rather than refused.
 */
async function resolveLocalLegs(raw: unknown): Promise<{ legs: RawLeg[]; timesLocal: boolean }> {
  const legs = Array.isArray((raw as { legs?: unknown })?.legs) ? (raw as { legs: RawLeg[] }).legs : [];
  const tzCache = await tzCacheFor(legs);
  const allResolved = legs.every(
    (l) => tzCache.get(String(l.departurePlace).toUpperCase()) && tzCache.get(String(l.arrivalPlace).toUpperCase()),
  );

  if (!allResolved) {
    // Keep the wall-clock as the stored time; it is local, not UTC.
    return {
      legs: legs.map((leg) => ({ ...leg, departureTime: asInstantString(leg.departureTime), arrivalTime: asInstantString(leg.arrivalTime) })),
      timesLocal: true,
    };
  }

  const converted = legs.map((leg) => {
    const depTz = tzCache.get(String(leg.departurePlace).toUpperCase())!;
    const arrTz = tzCache.get(String(leg.arrivalPlace).toUpperCase())!;
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
  });
  return { legs: converted, timesLocal: false };
}

/**
 * Project a UTC-source request down to wall-clock at each aerodrome and stamp
 * timesLocal. Used when the import token says "store in local time" — the school
 * sends real UTC, but the pilot wants their logbook to read in local civil time
 * (matches how they log non-imported flights at the same field). Legs whose
 * aerodrome has no timezone on file are passed through unchanged: their original
 * UTC string stays, since we have nothing to shift against.
 */
async function projectUtcToLocalLegs(raw: unknown): Promise<{ legs: RawLeg[]; timesLocal: boolean }> {
  const legs = Array.isArray((raw as { legs?: unknown })?.legs) ? (raw as { legs: RawLeg[] }).legs : [];
  const tzCache = await tzCacheFor(legs);
  const out = legs.map((leg) => {
    const depTz = tzCache.get(String(leg.departurePlace).toUpperCase()) ?? null;
    const arrTz = tzCache.get(String(leg.arrivalPlace).toUpperCase()) ?? null;
    try {
      return {
        ...leg,
        departureTime: depTz ? zonedUtcToWallClock(String(leg.departureTime), depTz) : asInstantString(leg.departureTime),
        arrivalTime:   arrTz ? zonedUtcToWallClock(String(leg.arrivalTime),   arrTz) : asInstantString(leg.arrivalTime),
      };
    } catch (err) {
      if (err instanceof LocalTimeError) throw new RequestError(err.message);
      throw err;
    }
  });
  return { legs: out, timesLocal: true };
}

/**
 * Wrap each leg time so it parses as a UTC instant downstream, without any
 * conversion. Used when source and store are both LOCAL — the importer sends
 * wall-clock, we store wall-clock, no aerodrome timezone enters the picture.
 */
function keepLocalLegs(raw: unknown): { legs: RawLeg[]; timesLocal: boolean } {
  const legs = Array.isArray((raw as { legs?: unknown })?.legs) ? (raw as { legs: RawLeg[] }).legs : [];
  return {
    legs: legs.map((leg) => ({ ...leg, departureTime: asInstantString(leg.departureTime), arrivalTime: asInstantString(leg.arrivalTime) })),
    timesLocal: true,
  };
}

function resolveAircraftCategory(raw: unknown, tmgFiling: "AEROPLANE" | "SAILPLANE"): unknown {
  const body = raw as { aircraft?: { category?: unknown } } | null;
  if (!body || typeof body !== "object" || !body.aircraft) return raw;
  if (body.aircraft.category !== "TMG") return raw;
  return { ...body, aircraft: { ...body.aircraft, category: tmgFiling } };
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
  const day = input.landings.day || 0;
  const night = input.landings.night || 0;
  // Trust an explicit day/night split (typically supplied by the SPA when the
  // flight crosses civil twilight, so a multi-leg or sunset-crossing flight
  // can record landings in both buckets). When only one bucket is non-zero we
  // fall back to the original auto-classification against the final arrival.
  if (day > 0 && night > 0) return { day, night };
  const total = day + night;
  if (total === 0) return { day: 0, night: 0 };
  const lastLeg = input.legs[input.legs.length - 1]!;
  const coords = await getAirportCoords(lastLeg.arrivalPlace);
  return isNightAt(lastLeg.arrivalTime, coords) ? { day: 0, night: total } : { day: total, night: 0 };
}

/**
 * Validate and enrich a raw request body into a stored-ready entry. The holder id
 * always comes from the session (or from the resolved import token). `opts.importPrefs`
 * carries the per-token preferences when the call originates from the Import API;
 * when absent (SPA path) defaults match historical behavior: source/store both
 * derived from the body's own `timeZone` field. Throws RequestError on a bad body
 * or an unconvertible local time (the caller maps that to a 400).
 *
 * Time-zone matrix:
 *   sourceTz   storeTz    behavior
 *   UTC        UTC        legs pass through as ISO Z, timesLocal=false (default)
 *   LOCAL      UTC        wall-clock → UTC via aerodrome tz (existing path)
 *   UTC        LOCAL      UTC → wall-clock at aerodrome tz, timesLocal=true
 *   LOCAL      LOCAL      keep wall-clock as-is, timesLocal=true, no aerodrome lookup
 *
 * TMG resolution: when an Import API request carries `aircraft.category="TMG"`,
 * it is rewritten to the token's tmgCategory (AEROPLANE or SAILPLANE) before the
 * normal parser runs, so all downstream rules (column layout, allowed attributes,
 * signature rules) act on the filed category, not the source hint.
 */
export async function prepareFlightEntry(
  raw: unknown,
  pilotId: string,
  opts: { excludeEntryId?: string; importPrefs?: ImportPrefs } = {},
): Promise<PreparedEntry> {
  const bodyTimeZone = (raw as { timeZone?: unknown } | null)?.timeZone;
  const sourceTz: "UTC" | "LOCAL" =
    bodyTimeZone === "LOCAL" ? "LOCAL" :
    bodyTimeZone === "UTC"   ? "UTC"   :
    opts.importPrefs?.sourceTimeZone ?? "UTC";
  const storeTz: "UTC" | "LOCAL" = opts.importPrefs?.storeTimeZone ?? "UTC";

  // TMG hint resolution runs before any parsing — the rest of the pipeline
  // sees AEROPLANE or SAILPLANE, never TMG.
  let body = opts.importPrefs
    ? resolveAircraftCategory(raw, opts.importPrefs.tmgCategory)
    : raw;

  let timesLocal = false;
  if (sourceTz === "LOCAL" && storeTz === "UTC") {
    const resolved = await resolveLocalLegs(body);
    body = { ...(body as object), legs: resolved.legs };
    timesLocal = resolved.timesLocal;
  } else if (sourceTz === "UTC" && storeTz === "LOCAL") {
    const projected = await projectUtcToLocalLegs(body);
    body = { ...(body as object), legs: projected.legs };
    timesLocal = projected.timesLocal;
  } else if (sourceTz === "LOCAL" && storeTz === "LOCAL") {
    const kept = keepLocalLegs(body);
    body = { ...(body as object), legs: kept.legs };
    timesLocal = kept.timesLocal;
  }
  // UTC → UTC: nothing to do; the legs already parse as ISO Z.

  const input = parseEntryRequest({ ...(body as object), pilotId });
  if (sourceTz === "LOCAL") input.enteredInLocalTime = true;
  if (timesLocal) input.timesLocal = true;

  // No-future-date guard. With true UTC times we allow 60s of NTP slack. With
  // a local-time entry we don't know the user's offset; the most easterly real
  // timezone is UTC+14 (Kiribati), so a local time stored as if-UTC can be at
  // most 14 hours ahead of the corresponding real UTC. Anything beyond that is
  // certainly in the future no matter where on earth the pilot is.
  const latestArrival = Math.max(...input.legs.map((l) => l.arrivalTime.getTime()));
  const futureGraceMs = timesLocal ? 14 * 60 * 60 * 1000 + 60_000 : 60_000;
  if (latestArrival > Date.now() + futureGraceMs) {
    return { ok: false, status: 422, body: { valid: false, issues: [{ field: "legs", message: "A flight cannot be logged with a date or time in the future." }] } };
  }

  input.conditions.night = await computeNight(input);
  input.landings = await classifyLandings(input);

  const result = validateEntry(input);
  if (!result.valid || !result.derived) {
    return { ok: false, status: 422, body: { valid: false, issues: result.issues } };
  }

  // The day/night pattern over the whole flight, from the first departure's
  // position (consistent with how night time is computed).
  const firstLeg = input.legs[0]!;
  const lastLeg = input.legs[input.legs.length - 1]!;
  const pattern = dayNightPattern(
    firstLeg.departureTime,
    lastLeg.arrivalTime,
    await getAirportCoords(firstLeg.departurePlace),
  );
  if (pattern) result.derived.dayNightPattern = pattern;

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

function minutesToHHMM(m: number): string {
  const n = Number(m) || 0;
  if (n <= 0) return "00:00";
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function clockZ(v: unknown): string {
  const s = v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "";
  return s.length >= 16 ? `${s.slice(11, 16)}Z` : "";
}

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

/**
 * Structured diff between two stored entry-content payloads (the shape
 * buildVersionContent produces: { picName, remarks, aircraft, columns, ... }).
 * Returns only the fields that actually changed; an unchanged entry returns
 * an empty list. Used by the PDF change-log appendix to show a clear
 * before/after under each version row.
 */
export function diffEntryContent(
  oldContent: {
    columns?: Record<string, unknown>;
    picName?: string;
    remarks?: string;
    aircraft?: { registration?: string; makeModelVariant?: string };
  } | null,
  newContent: {
    columns?: Record<string, unknown>;
    picName?: string;
    remarks?: string;
    aircraft?: { registration?: string; makeModelVariant?: string };
  } | null,
): FieldChange[] {
  const oc = (oldContent?.columns ?? {}) as Record<string, unknown>;
  const nc = (newContent?.columns ?? {}) as Record<string, unknown>;
  const category = String(nc.category ?? oc.category ?? "AEROPLANE");
  const offLabel = category === "HELICOPTER" ? "Rotor start" : category === "BALLOON" ? "Departure time" : "Block off";
  const onLabel = category === "HELICOPTER" ? "Rotor stop" : category === "BALLOON" ? "Arrival time" : "Block on";
  const pairs: FieldChange[] = [];
  const add = (label: string, before: string, after: string) => {
    if (before !== after) pairs.push({ label, before, after });
  };
  add("Date", String(oc.date ?? ""), String(nc.date ?? ""));
  add("From", String(oc.departurePlace ?? ""), String(nc.departurePlace ?? ""));
  add("To", String(oc.arrivalPlace ?? ""), String(nc.arrivalPlace ?? ""));
  add(offLabel, clockZ(oc.departureTime), clockZ(nc.departureTime));
  add(onLabel, clockZ(oc.arrivalTime), clockZ(nc.arrivalTime));
  add("Total time", minutesToHHMM(Number(oc.total ?? 0)), minutesToHHMM(Number(nc.total ?? 0)));
  add("PIC", String(oldContent?.picName ?? ""), String(newContent?.picName ?? ""));
  add("Aircraft", String(oldContent?.aircraft?.registration ?? ""), String(newContent?.aircraft?.registration ?? ""));
  add("Day landings", String(Number(oc.dayLandings ?? 0)), String(Number(nc.dayLandings ?? 0)));
  add("Night landings", String(Number(oc.nightLandings ?? 0)), String(Number(nc.nightLandings ?? 0)));
  add("Night", minutesToHHMM(Number(oc.night ?? 0)), minutesToHHMM(Number(nc.night ?? 0)));
  add("IFR", minutesToHHMM(Number(oc.ifr ?? 0)), minutesToHHMM(Number(nc.ifr ?? 0)));
  add("Remarks", String(oldContent?.remarks ?? ""), String(newContent?.remarks ?? ""));
  return pairs;
}

/** A human-readable list of what changed, for the notice sent to a signer. */
export function summarizeChanges(
  oldContent: { columns?: Record<string, unknown>; picName?: string } | null,
  oldPicName: string,
  newDerived: DerivedColumns,
  newPicName: string,
): string[] {
  const oldForDiff = oldContent ? { ...oldContent, picName: oldPicName } : null;
  const newForDiff = {
    picName: newPicName,
    columns: {
      ...newDerived,
      departureTime: toUtcIso(newDerived.departureTime),
      arrivalTime: toUtcIso(newDerived.arrivalTime),
    } as unknown as Record<string, unknown>,
  };
  return diffEntryContent(oldForDiff, newForDiff).map(
    (c) => `${c.label}: ${c.before || "(empty)"} to ${c.after || "(empty)"}`,
  );
}
