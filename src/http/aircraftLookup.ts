/**
 * Look up an aircraft by registration from a public source.
 *
 * Registration data is public. When a registration is not yet in our reference
 * database we ask a free, key-less public API (adsbdb), normalise what it
 * returns, and the caller caches it into the reference table so it becomes part
 * of the maintained set. The normaliser is separated from the fetch so it can be
 * unit tested without a network. Any network or parsing failure yields null, so
 * a flaky third party degrades to "not found" rather than an error.
 *
 * adsbdb gives the ICAO type designator (e.g. PC12, EC35, BALL); we look that up
 * in the ICAO Doc 8643 table to classify the Part-FCL category and prefill the
 * engine type and count, rather than guessing. An unknown designator falls back
 * to aeroplane for an admin to correct.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";
import { lookupIcaoType } from "../data/icaoTypes.js";

const ENDPOINT = "https://api.adsbdb.com/v0/aircraft/";

/** Map an adsbdb aircraft response to our record shape, or null if unusable. */
export function normalizeAdsbdb(body: unknown, registration: string): AircraftRecord | null {
  const aircraft = (body as { response?: { aircraft?: Record<string, unknown> } } | null)?.response?.aircraft;
  if (!aircraft || typeof aircraft !== "object") return null;

  const manufacturer = typeof aircraft.manufacturer === "string" ? aircraft.manufacturer : "";
  const type = typeof aircraft.type === "string" ? aircraft.type : "";
  const icaoType = typeof aircraft.icao_type === "string" ? aircraft.icao_type : undefined;
  const model = [manufacturer, type].filter(Boolean).join(" ").trim();

  if (!model && !icaoType) return null;

  const info = lookupIcaoType(icaoType);
  const record: AircraftRecord = {
    // Store under the registration the caller asked for, so a later flight entry
    // that uses the same string validates against it.
    registration: registration.toUpperCase(),
    model: model || icaoType || "Unknown",
    // The designator is unknown to the Doc 8643 list: assume aeroplane, the
    // dominant case, and let the pilot or an admin correct it.
    category: info?.category ?? "AEROPLANE",
  };
  if (icaoType) record.icaoType = icaoType;
  if (info?.engineType) record.engineType = info.engineType;
  if (info?.engineCount) record.engineCount = info.engineCount;
  return record;
}

export async function lookupExternalAircraft(registration: string): Promise<AircraftRecord | null> {
  const reg = registration.trim();
  if (!reg) return null;
  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(reg)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return normalizeAdsbdb(await res.json(), reg);
  } catch {
    return null;
  }
}
