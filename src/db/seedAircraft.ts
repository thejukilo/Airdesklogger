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
import { allowedCategoriesForType } from "../data/icaoTypes.js";
import type { AircraftRecord } from "./referenceRepository.js";

const here = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = new Set(["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"]);

// Generic ICAO codes that cover many distinct aircraft (every glider is GLID,
// every balloon BALL); their model only lives in the register, not icao_types.
const GENERIC_CODES = new Set(["GLID", "BALL"]);

function resolveBundled(name: string): string {
  const candidates = [join(here, "..", "data", name), join(process.cwd(), "src", "data", name)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function column(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
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
    const type = typeCol === -1 ? "" : (r[typeCol] ?? "").trim();
    // A blank model is fine when the type is known: the ICAO code stands in and
    // enrichment fills the real model. Only registration plus some identity is
    // required.
    if (!registration || seen.has(registration) || (!model && !type)) continue;
    seen.add(registration);

    const rec: AircraftRecord = {
      registration,
      model: model || type,
      category: normalizeCategory(catCol === -1 ? "" : (r[catCol] ?? "")),
    };
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
  /** The Part-FCL categories the type may be logged under (first is default). */
  allowedCategories?: AircraftRecord["category"][];
}

/**
 * Enrich each record from its matching icao_types row:
 *  - the category is corrected to the type's, since the type is authoritative
 *    (registers that do not distinguish sailplanes list a glider as an
 *    aeroplane); a category the type already allows is kept (a motor-glider may
 *    be either an aeroplane or a sailplane);
 *  - a missing engine count is filled from the type.
 * The model is intentionally left as the register's: the canonical model name
 * is resolved at lookup time from icao_types (so an edit to the type table
 * surfaces immediately, and the per-tail register variant remains as fallback).
 */
export function enrichFromIcaoTypes(records: AircraftRecord[], icao: Map<string, IcaoModelInfo>): AircraftRecord[] {
  for (const rec of records) {
    const code = rec.icaoType?.trim().toUpperCase();
    if (!code) continue;
    const info = icao.get(code);
    if (!info) continue;
    const allowed = info.allowedCategories;
    if (allowed?.length && !allowed.includes(rec.category)) rec.category = allowed[0]!;
    if (GENERIC_CODES.has(code)) continue;
    if (info.engineCount != null && rec.engineCount == null) rec.engineCount = info.engineCount;
  }
  return records;
}

async function loadIcaoModelMap(): Promise<Map<string, IcaoModelInfo>> {
  const { rows } = await getPool().query("SELECT code, aircraft_model, engine_count, description, role FROM icao_types");
  const map = new Map<string, IcaoModelInfo>();
  for (const r of rows) {
    map.set(r.code as string, {
      aircraftModel: (r.aircraft_model as string) ?? null,
      engineCount: (r.engine_count as number) ?? null,
      allowedCategories: allowedCategoriesForType(r.description as string, (r.role as string) ?? null),
    });
  }
  return map;
}

/**
 * How an existing (registration, valid_from) row is handled: "update" refreshes
 * it, "skip" keeps it untouched (insert only new registrations).
 */
export type ConflictMode = "update" | "skip";

const ON_CONFLICT: Record<ConflictMode, string> = {
  update: `ON CONFLICT (registration, valid_from) DO UPDATE SET
             model = EXCLUDED.model, icao_type = EXCLUDED.icao_type, variant = EXCLUDED.variant, category = EXCLUDED.category,
             engine_type = EXCLUDED.engine_type, engine_count = EXCLUDED.engine_count,
             multi_pilot = EXCLUDED.multi_pilot, balloon_group = EXCLUDED.balloon_group`,
  skip: "ON CONFLICT (registration, valid_from) DO NOTHING",
};

/** Bulk-insert aircraft records, keyed on registration and valid-from date. */
export async function upsertAircraftBatch(records: AircraftRecord[], onConflict: ConflictMode = "update"): Promise<number> {
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
    const { rowCount } = await pool.query(
      `INSERT INTO aircraft (registration, model, icao_type, variant, category, engine_type, engine_count, multi_pilot, balloon_group, valid_from)
         VALUES ${values.join(",")}
       ${ON_CONFLICT[onConflict]}`,
      params,
    );
    written += rowCount ?? 0;
  }
  return written;
}

/**
 * Apply just the balloon_group column from a CSV against existing aircraft rows,
 * matched by registration. Used as a one-off backfill after the column was
 * added: it leaves every other field untouched and does not insert new rows.
 * Returns the number of rows updated.
 */
export async function applyBalloonGroupsFromCsv(text: string): Promise<number> {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return 0;
  const regCol = column(header, ["registration", "reg", "tail_number"]);
  const groupCol = column(header, ["balloon_group", "balloongroup"]);
  if (regCol === -1 || groupCol === -1) {
    throw new Error("CSV needs at least 'registration' and 'balloon_group' columns.");
  }
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const reg = (r[regCol] ?? "").trim().toUpperCase();
    const group = (r[groupCol] ?? "").trim().toUpperCase();
    if (!reg || seen.has(reg) || !"ABCD".includes(group)) continue;
    seen.add(reg);
    pairs.push([reg, group]);
  }
  if (pairs.length === 0) return 0;

  const pool = getPool();
  let updated = 0;
  const CHUNK = 1000;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    // Build a VALUES list and join on registration, so one statement covers
    // the whole chunk.
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach(([reg, group], j) => {
      const b = j * 2;
      values.push(`($${b + 1},$${b + 2})`);
      params.push(reg, group);
    });
    const { rowCount } = await pool.query(
      `UPDATE aircraft AS a SET balloon_group = v.group
         FROM (VALUES ${values.join(",")}) AS v(reg, "group")
        WHERE a.registration = v.reg AND a.category = 'BALLOON'`,
      params,
    );
    updated += rowCount ?? 0;
  }
  return updated;
}

/** Seed a register file (bundled Swiss by default), enriching models from icao_types. */
export async function seedAircraft(csvPath?: string, onConflict: ConflictMode = "update"): Promise<number> {
  const text = readFileSync(csvPath ?? resolveBundled("aircraftSwiss.csv"), "utf8");
  const records = enrichFromIcaoTypes(fromAircraftCsv(text), await loadIcaoModelMap());
  return upsertAircraftBatch(records, onConflict);
}

/** Seed the bundled Europe-wide register, skipping registrations already present. */
export function seedAircraftEurope(): Promise<number> {
  return seedAircraft(resolveBundled("aircraftEurope.csv"), "skip");
}

const isMain = process.argv[1]?.endsWith("seedAircraft.ts") || process.argv[1]?.endsWith("seedAircraft.js");
if (isMain) {
  const args = process.argv.slice(2);
  const europe = args.includes("--europe");
  const path = args.find((a) => !a.startsWith("--"));
  const run = europe ? seedAircraftEurope() : seedAircraft(path);
  run
    .then((n) => {
      const what = europe ? "Europe register, skipping existing" : path ? `from ${path}` : "bundled Swiss register";
      console.log(`Seeded ${n} aircraft (${what}).`);
      return closePool();
    })
    .catch((err) => {
      console.error("Aircraft seed failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
