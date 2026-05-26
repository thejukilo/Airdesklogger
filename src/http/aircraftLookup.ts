/**
 * Look up an aircraft by registration from a public source.
 *
 * Registration data is public. When a registration is not yet in our reference
 * database we ask the AirLabs fleet database, normalise what it returns, and the
 * caller caches it into the reference table so it becomes part of the maintained
 * set. AirLabs reports the aircraft's ICAO type designator and a description
 * ("landplane", "helicopter", and so on), which lets us classify the Part-FCL
 * category instead of guessing. The normaliser is separated from the fetch so it
 * can be unit tested without a network. A missing key, or any network or parsing
 * failure, yields null, so the lookup degrades to "not found" rather than an
 * error.
 *
 * The API key is read from AIRLABS_API_KEY and is never stored in the repository.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";

const ENDPOINT = "https://airlabs.co/api/v9/fleets";

type AircraftCategory = AircraftRecord["category"];

/**
 * Map an AirLabs aircraft description to a Part-FCL category. AirLabs' own
 * "category" field is the wake-turbulence class (L/M/H/J), not a Part-FCL
 * category, so we derive the category from the ICAO type designator and the
 * "type" description instead.
 */
function deriveCategory(icaoType: string, type: string): AircraftCategory {
  const code = icaoType.toUpperCase();
  if (code === "BALL") return "BALLOON";
  if (code === "GLID") return "SAILPLANE";
  const t = type.toLowerCase();
  if (t.includes("balloon")) return "BALLOON";
  if (t.includes("glider") || t.includes("sailplane")) return "SAILPLANE";
  if (t.includes("helicopter") || t.includes("gyro")) return "HELICOPTER";
  // landplane, seaplane, amphibian, tiltrotor, or anything unrecognised.
  return "AEROPLANE";
}

/** AirLabs returns the matches under "response", as an array (or a single object). */
function firstRecord(body: unknown): Record<string, unknown> | null {
  const resp = (body as { response?: unknown } | null)?.response;
  if (Array.isArray(resp)) return (resp.find((r) => r && typeof r === "object") as Record<string, unknown>) ?? null;
  if (resp && typeof resp === "object") return resp as Record<string, unknown>;
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Map an AirLabs fleets response to our record shape, or null if unusable. */
export function normalizeAirlabs(body: unknown, registration: string): AircraftRecord | null {
  const a = firstRecord(body);
  if (!a) return null;

  const manufacturer = str(a.manufacturer);
  const modelName = str(a.model);
  const icaoType = str(a.icao);
  const type = str(a.type);
  // Avoid repeating the manufacturer when the model already carries it.
  const model = modelName.toLowerCase().startsWith(manufacturer.toLowerCase()) && manufacturer
    ? modelName
    : [manufacturer, modelName].filter(Boolean).join(" ").trim();

  if (!model && !icaoType) return null;

  const rec: AircraftRecord = {
    // Store under the registration the caller asked for, so a later flight entry
    // that uses the same string validates against it.
    registration: registration.toUpperCase(),
    model: model || icaoType || "Unknown",
    category: deriveCategory(icaoType, type),
  };
  if (icaoType) rec.icaoType = icaoType;
  const engine = str(a.engine);
  if (engine) rec.engineType = engine;
  const engineCount = Number(a.engine_count);
  if (Number.isFinite(engineCount) && engineCount > 0) rec.engineCount = engineCount;
  return rec;
}

export async function lookupExternalAircraft(registration: string): Promise<AircraftRecord | null> {
  const reg = registration.trim();
  if (!reg) return null;
  const apiKey = process.env.AIRLABS_API_KEY;
  if (!apiKey) return null;
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("reg_number", reg);
    url.searchParams.set("api_key", apiKey);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return normalizeAirlabs(await res.json(), reg);
  } catch {
    return null;
  }
}
