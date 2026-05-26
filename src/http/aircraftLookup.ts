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
 * adsbdb carries the ICAO type designator, which uses the pseudo-codes BALL for
 * balloons and GLID for gliders, so those categories are classified rather than
 * guessed. It has no distinct marker for rotorcraft, so helicopters carry their
 * real type code (e.g. R44, EC35) and fall through to aeroplane; an admin can
 * correct the category for those.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";

const ENDPOINT = "https://api.adsbdb.com/v0/aircraft/";

type AircraftCategory = AircraftRecord["category"];

function deriveCategory(icaoType: string, flagCode: string): AircraftCategory {
  const codes = [icaoType.toUpperCase(), flagCode.toUpperCase()];
  if (codes.includes("BALL")) return "BALLOON";
  if (codes.includes("GLID")) return "SAILPLANE";
  return "AEROPLANE";
}

/** Map an adsbdb aircraft response to our record shape, or null if unusable. */
export function normalizeAdsbdb(body: unknown, registration: string): AircraftRecord | null {
  const aircraft = (body as { response?: { aircraft?: Record<string, unknown> } } | null)?.response?.aircraft;
  if (!aircraft || typeof aircraft !== "object") return null;

  const manufacturer = typeof aircraft.manufacturer === "string" ? aircraft.manufacturer : "";
  const type = typeof aircraft.type === "string" ? aircraft.type : "";
  const icaoType = typeof aircraft.icao_type === "string" ? aircraft.icao_type : undefined;
  const flagCode = typeof aircraft.registered_owner_operator_flag_code === "string"
    ? aircraft.registered_owner_operator_flag_code
    : "";
  const model = [manufacturer, type].filter(Boolean).join(" ").trim();

  if (!model && !icaoType) return null;

  return {
    // Store under the registration the caller asked for, so a later flight entry
    // that uses the same string validates against it.
    registration: registration.toUpperCase(),
    model: model || icaoType || "Unknown",
    ...(icaoType ? { icaoType } : {}),
    category: deriveCategory(icaoType ?? "", flagCode),
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
