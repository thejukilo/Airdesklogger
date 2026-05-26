/**
 * Loads the ICAO Doc 8643 type designator list into the reference database.
 *
 * The bundled list (src/data/icaoTypes.csv) carries every designator with its
 * description (LandPlane, Helicopter, Balloon, ...) and engine type and count.
 * A registration lookup uses it to classify an aircraft's category. Run once
 * after migrating; it is idempotent (upsert), so re-running refreshes the data:
 *
 *   npm run seed:icao-types            # bundled list
 *   npm run seed:icao-types -- ./x.csv # a replacement list
 *
 * The CSV has one row per manufacturer/model and many share a type code, so the
 * first row seen for a code wins (the description is consistent per code).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "./seedAirports.js";
import { upsertIcaoTypes, type IcaoTypeSeed } from "./referenceRepository.js";
import { closePool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED_CSV = join(here, "..", "data", "icaoTypes.csv");

function column(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n.trim());
    if (i !== -1) return i;
  }
  return -1;
}

export function fromIcaoTypesCsv(text: string): IcaoTypeSeed[] {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((h) => h.trim());
  if (!header) return [];
  const codeCol = column(header, ["type", "typecode", "icao_type"]);
  const descCol = column(header, ["description"]);
  const engCol = column(header, ["engine", "engine_type"]);
  const countCol = column(header, ["engine_count", "engines"]);
  if (codeCol === -1 || descCol === -1) {
    throw new Error("ICAO types CSV needs at least 'type' and 'description' columns.");
  }
  const seen = new Set<string>();
  const out: IcaoTypeSeed[] = [];
  for (const r of rows) {
    const code = (r[codeCol] ?? "").trim().toUpperCase();
    const description = (r[descCol] ?? "").trim();
    if (!code || !description || seen.has(code)) continue;
    seen.add(code);
    const engine = engCol === -1 ? "" : (r[engCol] ?? "").trim();
    const count = countCol === -1 ? NaN : Number((r[countCol] ?? "").trim());
    out.push({
      code,
      description,
      engineType: engine && engine !== "-" ? engine : null,
      engineCount: Number.isInteger(count) && count > 0 ? count : null,
    });
  }
  return out;
}

export async function seedIcaoTypes(csvPath?: string): Promise<number> {
  const text = readFileSync(csvPath ?? BUNDLED_CSV, "utf8");
  return upsertIcaoTypes(fromIcaoTypesCsv(text));
}

const isMain = process.argv[1]?.endsWith("seedIcaoTypes.ts") || process.argv[1]?.endsWith("seedIcaoTypes.js");
if (isMain) {
  const path = process.argv[2];
  seedIcaoTypes(path)
    .then((n) => {
      console.log(`Seeded ${n} ICAO type designators${path ? ` from ${path}` : " (bundled list)"}.`);
      return closePool();
    })
    .catch((err) => {
      console.error("ICAO types seed failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
