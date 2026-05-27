/**
 * Loads the certified simulator (FSTD) list into the reference database.
 *
 * The bundled list (src/data/simulators.csv) carries each device's EASA code,
 * serial number, aircraft type and qualification (plus manufacturers and
 * location). A pilot logging a simulator session picks a device by autocomplete
 * on the EASA code or serial number. Run once after migrating; idempotent
 * (replaces the table), so re-running refreshes the data:
 *
 *   npm run seed:simulators            # bundled list
 *   npm run seed:simulators -- ./x.csv # a replacement list
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "./seedAirports.js";
import { replaceSimulators, type Simulator } from "./referenceRepository.js";
import { closePool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

function resolveBundledCsv(): string {
  const candidates = [join(here, "..", "data", "simulators.csv"), join(process.cwd(), "src", "data", "simulators.csv")];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function column(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n.trim());
    if (i !== -1) return i;
  }
  return -1;
}

export function fromSimulatorsCsv(text: string): Simulator[] {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((h) => h.trim());
  if (!header) return [];
  const codeCol = column(header, ["easa_code"]);
  const snCol = column(header, ["serial_number"]);
  const evalCol = column(header, ["eval_type"]);
  const acManCol = column(header, ["aircraft_man"]);
  const acTypeCol = column(header, ["aircraft_type"]);
  const simManCol = column(header, ["sim_man"]);
  const qualCol = column(header, ["qualification"]);
  const locCol = column(header, ["location"]);
  if (codeCol === -1) throw new Error("Simulators CSV needs an 'easa_code' column.");
  const cell = (r: string[], i: number): string | null => {
    if (i === -1) return null;
    const s = (r[i] ?? "").trim();
    return s && s.toLowerCase() !== "not applicable" ? s : null;
  };
  // One row per EASA code: a duplicate code is dropped (the first wins).
  const seen = new Set<string>();
  const out: Simulator[] = [];
  for (const r of rows) {
    const easaCode = (r[codeCol] ?? "").trim();
    if (!easaCode || seen.has(easaCode)) continue;
    seen.add(easaCode);
    out.push({
      easaCode,
      serialNumber: cell(r, snCol),
      aircraftType: cell(r, acTypeCol),
      qualification: cell(r, qualCol),
      evalType: cell(r, evalCol),
      aircraftManufacturer: cell(r, acManCol),
      simManufacturer: cell(r, simManCol),
      location: cell(r, locCol),
    });
  }
  return out;
}

export async function seedSimulators(csvPath?: string): Promise<number> {
  const text = readFileSync(csvPath ?? resolveBundledCsv(), "utf8");
  return replaceSimulators(fromSimulatorsCsv(text));
}

const isMain = process.argv[1]?.endsWith("seedSimulators.ts") || process.argv[1]?.endsWith("seedSimulators.js");
if (isMain) {
  const path = process.argv[2];
  seedSimulators(path)
    .then((n) => {
      console.log(`Seeded ${n} simulators${path ? ` from ${path}` : " (bundled list)"}.`);
      return closePool();
    })
    .catch((err) => {
      console.error("Simulator seed failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
