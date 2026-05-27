/**
 * Bulk import of aircraft into the reference table.
 *
 * National registers are mapped to the aircraft columns and loaded here. The
 * bundled Swiss register (src/data/aircraftSwiss.csv) is the default; a different
 * file (or AIRCRAFT_CSV_URL via the admin import action) can be used instead.
 * Run after seeding icao_types:
 *
 *   npm run seed:aircraft            # bundled Swiss register
 *   npm run seed:aircraft -- ./x.csv # another register, same columns
 *
 * For a specific type (not the generic GLID/BALL codes), the model and engine
 * count are taken from the icao_types table - so A210 shows "Aquila A-210"
 * rather than the register's "AT01-100C" - while gliders and balloons keep the
 * register's own model. The primary way aircraft enter the table remains the
 * on-demand registration lookup; this loads a whole fleet at once.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, closePool } from "./pool.js";
import { parseCsv } from "./seedAirports.js";
import type { AircraftRecord } from "./referenceRepository.js";

const here = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = new Set(["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"]);

// Generic ICAO codes that cover many distinct aircraft (every glider is GLID,
// every balloon BALL); their model only lives in the register, not icao_types.
const GENERIC_CODES = new Set(["GLID", "BALL"]);

function resolveBundledCsv(): string {
  const candidates = [join(here, "..", "data", "aircraftSwiss.csv"), join(process.cwd(), "src", "data", "aircraftSwiss.csv")];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function column(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

/** Map a register's category text to one of the four Part-FCL categories. */
function normalizeCategory(raw: string): AircraftRecord["category"] {
  const c = raw.trim().toUpperCase();
  if (CATEGORIES.has(c)) return c as AircraftRecord["category"];
  if (c.includes("BALLOON") || c.includes("AIRSHIP")) return "BALLOON";
  if (c.includes("GLID") || c.includes("SAILPLANE")) return "SAILPLANE";
  if (c.includes("HELICOPTER") || c.includes("GYRO") || c.includes("ROTOR")) return "HELICOPTER";
  return "AEROPLANE";
}

export function fromAircraftCsv(text: string): AircraftRecord[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return [];
  const regCol = column(header, ["registration", "reg", "tail_number"]);
  const modelCol = column(header, ["model", "name"]);
  const typeCol = column(header, ["typecode", "icao_type", "icaotype", "type"]);
  const variantCol = column(header, ["variant"]);
  const catCol = column(header, ["category"]);
  const engTypeCol = column(header, ["engine_type", "enginetype"]);
  const engCountCol = column(header, ["engine_count", "enginecount", "engines"]);
  const mpCol = column(header, ["multi_pilot", "multipilot"]);
  const balloonCol = column(header, ["balloon_group", "balloongroup"]);
  if (regCol === -1 || modelCol === -1) {
    throw new Error("Aircraft CSV needs at least 'registration' and 'model' columns.");
  }

  const out: AircraftRecord[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const registration = (r[regCol] ?? "").trim().toUpperCase();
    const model = (r[modelCol] ?? "").trim();
    if (!registration || !model || seen.has(registration)) continue;
    seen.add(registration);

    const rec: AircraftRecord = {
      registration,
      model,
      category: normalizeCategory(catCol === -1 ? "" : (r[catCol] ?? "")),
    };
    const type = typeCol === -1 ? "" : (r[typeCol] ?? "").trim();
    if (type) rec.icaoType = type;
    const variant = variantCol === -1 ? "" : (r[variantCol] ?? "").trim();
    if (variant) rec.variant = variant;
    const engineType = engTypeCol === -1 ? "" : (r[engTypeCol] ?? "").trim();
    if (engineType) rec.engineType = engineType;
    const engineCount = engCountCol === -1 ? NaN : Number((r[engCountCol] ?? "").trim());
    if (Number.isFinite(engineCount) && engineCount > 0) rec.engineCount = engineCount;
    if (mpCol !== -1) {
      const v = (r[mpCol] ?? "").trim().toLowerCase();
      rec.multiPilot = v === "true" || v === "1" || v === "yes";
    }
    const balloonGroup = balloonCol === -1 ? "" : (r[balloonCol] ?? "").trim();
    if (balloonGroup) rec.balloonGroup = balloonGroup;
    out.push(rec);
  }
  return out;
}

export interface IcaoModelInfo {
  aircraftModel: string | null;
  engineCount: number | null;
}

/**
 * Fill the model and engine count from the matching icao_types row, except for
 * the generic glider/balloon codes which keep the register's own model. The
 * icao_types model is only set for unambiguous codes (the seed nulls codes that
 * span several models), so an ambiguous type also keeps the register's model.
 */
export function enrichFromIcaoTypes(records: AircraftRecord[], icao: Map<string, IcaoModelInfo>): AircraftRecord[] {
  for (const rec of records) {
    const code = rec.icaoType?.trim().toUpperCase();
    if (!code || GENERIC_CODES.has(code)) continue;
    const info = icao.get(code);
    if (!info) continue;
    if (info.aircraftModel) rec.model = info.aircraftModel;
    if (info.engineCount != null) rec.engineCount = info.engineCount;
  }
  return records;
}

async function loadIcaoModelMap(): Promise<Map<string, IcaoModelInfo>> {
  const { rows } = await getPool().query("SELECT code, aircraft_model, engine_count FROM icao_types");
  const map = new Map<string, IcaoModelInfo>();
  for (const r of rows) {
    map.set(r.code as string, {
      aircraftModel: (r.aircraft_model as string) ?? null,
      engineCount: (r.engine_count as number) ?? null,
    });
  }
  return map;
}

/** Bulk-upsert aircraft records, keyed on registration and valid-from date. */
export async function upsertAircraftBatch(records: AircraftRecord[]): Promise<number> {
  const pool = getPool();
  let written = 0;
  const CHUNK = 1000; // 10 params per row
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((a, j) => {
      const b = j * 10;
      values.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9}, COALESCE($${b + 10}::date,'1970-01-01'))`,
      );
      params.push(
        a.registration.trim().toUpperCase(),
        a.model,
        a.icaoType ?? null,
        a.variant ?? null,
        a.category,
        a.engineType ?? null,
        a.engineCount ?? null,
        a.multiPilot ?? false,
        a.balloonGroup ?? null,
        a.validFrom ?? null,
      );
    });
    await pool.query(
      `INSERT INTO aircraft (registration, model, icao_type, variant, category, engine_type, engine_count, multi_pilot, balloon_group, valid_from)
         VALUES ${values.join(",")}
       ON CONFLICT (registration, valid_from) DO UPDATE SET
         model = EXCLUDED.model, icao_type = EXCLUDED.icao_type, variant = EXCLUDED.variant, category = EXCLUDED.category,
         engine_type = EXCLUDED.engine_type, engine_count = EXCLUDED.engine_count,
         multi_pilot = EXCLUDED.multi_pilot, balloon_group = EXCLUDED.balloon_group`,
      params,
    );
    written += chunk.length;
  }
  return written;
}

/** Seed the bundled (or given) register, enriching models from icao_types. */
export async function seedAircraft(csvPath?: string): Promise<number> {
  const text = readFileSync(csvPath ?? resolveBundledCsv(), "utf8");
  const records = enrichFromIcaoTypes(fromAircraftCsv(text), await loadIcaoModelMap());
  return upsertAircraftBatch(records);
}

const isMain = process.argv[1]?.endsWith("seedAircraft.ts") || process.argv[1]?.endsWith("seedAircraft.js");
if (isMain) {
  const path = process.argv[2];
  seedAircraft(path)
    .then((n) => {
      console.log(`Seeded ${n} aircraft${path ? ` from ${path}` : " (bundled Swiss register)"}.`);
      return closePool();
    })
    .catch((err) => {
      console.error("Aircraft seed failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
