/**
 * Look up an aircraft by registration from a public source.
 *
 * Registration data is public. When a registration is not yet in our reference
 * database we ask a free, key-less public API (adsbdb), normalise what it
 * returns, and the caller caches it into the reference table so it becomes part
 * of the maintained set. The normaliser is separated from the fetch so it can be
 * unit tested without a network. Any network or parsing failure yields null, so
 * a flaky third party degrades to "not found" rather than an error.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";

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

  return {
    // Store under the registration the caller asked for, so a later flight entry
    // that uses the same string validates against it.
    registration: registration.toUpperCase(),
    model: model || icaoType || "Unknown",
    ...(icaoType ? { icaoType } : {}),
    // adsbdb does not classify category or engines; default to aeroplane and let
    // the pilot adjust. This is a prefill, not an authority.
    category: "AEROPLANE",
  };
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
