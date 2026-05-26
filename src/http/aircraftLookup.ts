/**
 * Look up an aircraft by registration from a public source.
 *
 * Registration data is public. When a registration is not yet in our reference
 * database we ask a free, key-less public API (adsbdb), normalise what it
 * returns, and the caller caches it into the reference table so it becomes part
 * of the maintained set. Parsing the adsbdb body is separated from the database
 * classification so it can be unit tested without a network. Any network or
 * parsing failure yields null, so a flaky third party degrades to "not found".
 *
 * adsbdb gives the ICAO type designator (e.g. PC12, EC35, BALL); we resolve that
 * against the icao_types reference table to classify the Part-FCL category and
 * prefill the engine type and count. An unknown designator (or an unseeded
 * table) falls back to aeroplane for an admin to correct.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";
import { getIcaoType } from "../db/referenceRepository.js";

const ENDPOINT = "https://api.adsbdb.com/v0/aircraft/";

export interface ParsedAircraft {
  registration: string;
  model: string;
  icaoType?: string | undefined;
}

/** Pull the registration, model and ICAO type from an adsbdb response. */
export function parseAdsbdb(body: unknown, registration: string): ParsedAircraft | null {
  const aircraft = (body as { response?: { aircraft?: Record<string, unknown> } } | null)?.response?.aircraft;
  if (!aircraft || typeof aircraft !== "object") return null;

  const manufacturer = typeof aircraft.manufacturer === "string" ? aircraft.manufacturer : "";
  const type = typeof aircraft.type === "string" ? aircraft.type : "";
  const icaoType = typeof aircraft.icao_type === "string" ? aircraft.icao_type : undefined;
  const model = [manufacturer, type].filter(Boolean).join(" ").trim();

  if (!model && !icaoType) return null;
  return {
    // The registration the caller asked for, so a later flight entry that uses
    // the same string validates against the cached record.
    registration: registration.toUpperCase(),
    model: model || icaoType || "Unknown",
    icaoType,
  };
}

export async function lookupExternalAircraft(registration: string): Promise<AircraftRecord | null> {
  const reg = registration.trim();
  if (!reg) return null;
  let parsed: ParsedAircraft | null;
  try {
    const res = await fetch(`${ENDPOINT}${encodeURIComponent(reg)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    parsed = parseAdsbdb(await res.json(), reg);
  } catch {
    return null;
  }
  if (!parsed) return null;

  const info = parsed.icaoType ? await getIcaoType(parsed.icaoType) : null;
  const record: AircraftRecord = {
    registration: parsed.registration,
    model: parsed.model,
    category: info?.category ?? "AEROPLANE",
  };
  if (parsed.icaoType) record.icaoType = parsed.icaoType;
  if (info?.engineType) record.engineType = info.engineType;
  if (info?.engineCount) record.engineCount = info.engineCount;
  return record;
}
