/**
 * Bulk import of aircraft into the reference table.
 *
 * Unlike airports there is no single canonical free register of every aircraft,
 * so this reads a CSV whose location is configured by the deployment
 * (AIRCRAFT_CSV_URL). Columns are detected by common header names, so a range of
 * sources work. It is best-effort: the category defaults to aeroplane when the
 * source does not give one of the four Part-FCL categories, and a pilot can
 * correct a record. The primary way aircraft enter the table remains the
 * on-demand registration lookup; this is for loading a known fleet at once.
 */

import { getPool } from "./pool.js";
import { parseCsv } from "./seedAirports.js";
import type { AircraftRecord } from "./referenceRepository.js";

const CATEGORIES = new Set(["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"]);

function column(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

export function fromAircraftCsv(text: string): AircraftRecord[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return [];
  const regCol = column(header, ["registration", "reg", "tail_number"]);
  const modelCol = column(header, ["model", "name"]);
  const typeCol = column(header, ["typecode", "icao_type", "icaotype", "type"]);
  const catCol = column(header, ["category"]);
  const engTypeCol = column(header, ["engine_type", "enginetype"]);
  const engCountCol = column(header, ["engine_count", "enginecount", "engines"]);
  const mpCol = column(header, ["multi_pilot", "multipilot"]);
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

    const catRaw = (catCol === -1 ? "" : (r[catCol] ?? "")).trim().toUpperCase();
    const rec: AircraftRecord = {
      registration,
      model,
      category: (CATEGORIES.has(catRaw) ? catRaw : "AEROPLANE") as AircraftRecord["category"],
    };
    const type = typeCol === -1 ? "" : (r[typeCol] ?? "").trim();
    if (type) rec.icaoType = type;
    const engineType = engTypeCol === -1 ? "" : (r[engTypeCol] ?? "").trim();
    if (engineType) rec.engineType = engineType;
    const engineCount = engCountCol === -1 ? NaN : Number((r[engCountCol] ?? "").trim());
    if (Number.isFinite(engineCount) && engineCount > 0) rec.engineCount = engineCount;
    if (mpCol !== -1) {
      const v = (r[mpCol] ?? "").trim().toLowerCase();
      rec.multiPilot = v === "true" || v === "1" || v === "yes";
    }
    out.push(rec);
  }
  return out;
}

/** Bulk-upsert aircraft records, keyed on registration and valid-from date. */
export async function upsertAircraftBatch(records: AircraftRecord[]): Promise<number> {
  const pool = getPool();
  let written = 0;
  const CHUNK = 1000; // 8 params per row
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((a, j) => {
      const b = j * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}, COALESCE($${b + 8}::date,'1970-01-01'))`);
      params.push(
        a.registration.trim().toUpperCase(),
        a.model,
        a.icaoType ?? null,
        a.category,
        a.engineType ?? null,
        a.engineCount ?? null,
        a.multiPilot ?? false,
        a.validFrom ?? null,
      );
    });
    await pool.query(
      `INSERT INTO aircraft (registration, model, icao_type, category, engine_type, engine_count, multi_pilot, valid_from)
         VALUES ${values.join(",")}
       ON CONFLICT (registration, valid_from) DO UPDATE SET
         model = EXCLUDED.model, icao_type = EXCLUDED.icao_type, category = EXCLUDED.category,
         engine_type = EXCLUDED.engine_type, engine_count = EXCLUDED.engine_count, multi_pilot = EXCLUDED.multi_pilot`,
      params,
    );
    written += chunk.length;
  }
  return written;
}
