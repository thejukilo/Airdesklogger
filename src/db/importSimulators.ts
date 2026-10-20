/**
 * Rebuilds the bundled certified-simulator list (src/data/simulators.csv) from
 * the authoritative EASA source, with integrity checks.
 *
 * WHY THIS EXISTS
 * ---------------
 * The current src/data/simulators.csv is scrambled fixture data: each column
 * holds genuine EASA-register values, but the columns were permuted
 * independently per row, so the rows are internally incoherent (a DE-coded
 * device located in Dublin, an Embraer "A330", the same EASA code on five
 * different rows). It is fine as demo data for the autocomplete, but it is not
 * a usable reference list. This importer produces a clean, aligned CSV in the
 * exact schema seedSimulators.ts already reads, so the Admin "Seed simulators"
 * button keeps working unchanged.
 *
 * THE SOURCE
 * ----------
 * EASA publishes the list of qualified FSTDs at:
 *   https://lisstdis.easa.europa.eu/eqstdis/        (searchable database)
 *   https://www.easa.europa.eu/en/domains/aircrew-and-medical/flight-simulation-training-devices-fstd
 *                                                   ("Downloads": PDF certificate list)
 * The database rows carry EASA code, operator/location, qualification level,
 * simulator manufacturer, represented aircraft type and status.
 *
 * This matches seedAirports.ts: we do NOT scrape a live site here. You export
 * the EASA list once (CSV/XLSX->CSV from the database, or the published list),
 * then run this importer against that file. Keeping a human download step means
 * one stable, reviewable input instead of a brittle scraper tied to the EASA
 * page markup, and it works from a cloud session whose network policy does not
 * allowlist the EASA host.
 *
 *   npm run import:simulators -- ./easa-fstd-export.csv
 *     # validates, then overwrites src/data/simulators.csv
 *   npm run import:simulators -- ./easa-fstd-export.csv --check
 *     # validate and report only; do not write
 *
 * After it writes, run the existing seeder (or click Admin -> "Seed simulators")
 * to load the refreshed CSV into the database:
 *   npm run seed:simulators
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "./seedAirports.js";
import type { Simulator } from "./referenceRepository.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The canonical column order seedSimulators.ts reads. */
const CANONICAL_HEADER = [
  "easa_code",
  "serial_number",
  "eval_type",
  "aircraft_man",
  "aircraft_type",
  "sim_man",
  "qualification",
  "location",
] as const;

/**
 * Candidate header names for each canonical column, so an EASA export whose
 * headers differ in wording still maps. Matching is case-insensitive and
 * ignores surrounding whitespace. Extend these lists once you have seen the
 * exact headers of the EASA export you download.
 */
const SOURCE_COLUMNS: Record<(typeof CANONICAL_HEADER)[number], string[]> = {
  easa_code: ["easa_code", "easa code", "fstd code", "code"],
  serial_number: ["serial_number", "serial number", "serial", "s/n", "sn"],
  eval_type: ["eval_type", "evaluation type", "evaluation", "eval"],
  aircraft_man: ["aircraft_man", "aircraft manufacturer", "aeroplane manufacturer", "a/c manufacturer"],
  aircraft_type: ["aircraft_type", "aircraft type", "represented aircraft", "type", "aeroplane type"],
  sim_man: ["sim_man", "fstd manufacturer", "simulator manufacturer", "device manufacturer", "manufacturer"],
  qualification: ["qualification", "qualification level", "level", "fstd type"],
  location: ["location", "operator", "operator / location", "training organisation", "ato", "address"],
};

function pickColumn(header: string[], names: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = norm.indexOf(n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

const clean = (v: string | undefined): string => {
  const s = (v ?? "").replace(/ /g, " ").trim();
  return s && s.toLowerCase() !== "not applicable" ? s : "";
};

/**
 * Parse a raw EASA export into canonical Simulator rows. De-dupes by EASA code
 * (a code identifies one device) keeping the first occurrence, like the seeder.
 */
export function fromEasaExport(text: string): Simulator[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return [];
  const col = {} as Record<(typeof CANONICAL_HEADER)[number], number>;
  for (const key of CANONICAL_HEADER) col[key] = pickColumn(header, SOURCE_COLUMNS[key]);
  if (col.easa_code === -1) {
    throw new Error(
      `Could not find an EASA-code column. Saw headers: ${header.join(", ")}. ` +
        `Add the real header name to SOURCE_COLUMNS.easa_code.`,
    );
  }
  const seen = new Set<string>();
  const out: Simulator[] = [];
  for (const r of rows) {
    const easaCode = clean(r[col.easa_code]);
    if (!easaCode || seen.has(easaCode)) continue;
    seen.add(easaCode);
    out.push({
      easaCode,
      serialNumber: clean(r[col.serial_number]) || null,
      aircraftType: clean(r[col.aircraft_type]) || null,
      qualification: clean(r[col.qualification]) || null,
      evalType: clean(r[col.eval_type]) || null,
      aircraftManufacturer: clean(r[col.aircraft_man]) || null,
      simManufacturer: clean(r[col.sim_man]) || null,
      location: clean(r[col.location]) || null,
    });
  }
  return out;
}

/** EASA code prefixes are ISO-ish country tags; map the ones used to a country. */
const CODE_PREFIX_COUNTRY: Record<string, string> = {
  AT: "AT", BE: "BE", CH: "CH", DE: "DE", DK: "DK", EL: "GR", ES: "ES", FI: "FI",
  FR: "FR", HR: "HR", IE: "IE", IT: "IT", LVA: "LV", MT: "MT", NL: "NL", PL: "PL",
  SK: "SK", SLO: "SI", SRB: "RS", BW: "DE",
};

/** Very rough location -> country, enough to sanity-check alignment. */
const LOCATION_HINTS: Array<[RegExp, string]> = [
  [/paris|toulouse|marseille|grenoble|bourget|cdg|france/i, "FR"],
  [/frankfurt|berlin|m[uü]nchen|munich|essen|ganderkesee|strausberg|we[sß]ling|germany/i, "DE"],
  [/dublin|ireland/i, "IE"],
  [/madrid|barcelona|spain/i, "ES"],
  [/helsinki|pori|vantaa|finland/i, "FI"],
  [/amsterdam|emmen|schiphol|netherlands/i, "NL"],
  [/antwerp|brussels|belgium/i, "BE"],
  [/opfikon|z[uü]rich|geneva|gen[eè]ve|switzerland/i, "CH"],
  [/vienna|wien|austria/i, "AT"],
  [/warsaw|krak[oó]w|poland/i, "PL"],
  [/milan|rome|venegono|bresso|italy/i, "IT"],
];

function locationCountry(loc: string | null | undefined): string | null {
  if (!loc) return null;
  for (const [re, cc] of LOCATION_HINTS) if (re.test(loc)) return cc;
  return null;
}

export interface ValidationReport {
  total: number;
  problems: string[];
  coherencePct: number | null; // % of resolvable rows whose code-country matches location-country
}

/**
 * Integrity checks that would have caught the scrambled fixture file: duplicate
 * codes should not exist after de-dup, and a device's code country should agree
 * with its location. Low coherence means the columns are not aligned.
 */
export function validateSimulators(sims: Simulator[]): ValidationReport {
  const problems: string[] = [];
  if (sims.length === 0) problems.push("No rows parsed.");

  const missingType = sims.filter((s) => !s.aircraftType).length;
  if (missingType > sims.length * 0.2) {
    problems.push(`${missingType}/${sims.length} rows have no aircraft type.`);
  }

  let resolvable = 0;
  let matches = 0;
  for (const s of sims) {
    const prefix = s.easaCode.split(/[-\s]/)[0]?.toUpperCase() ?? "";
    const codeCountry = CODE_PREFIX_COUNTRY[prefix];
    const locCountry = locationCountry(s.location);
    if (codeCountry && locCountry) {
      resolvable++;
      if (codeCountry === locCountry) matches++;
    }
  }
  const coherencePct = resolvable ? (100 * matches) / resolvable : null;
  if (coherencePct !== null && coherencePct < 80) {
    problems.push(
      `Code-country vs location-country agree on only ${coherencePct.toFixed(1)}% ` +
        `of ${resolvable} resolvable rows (expected ~100%). The columns look misaligned/scrambled.`,
    );
  }
  return { total: sims.length, problems, coherencePct };
}

function toCanonicalCsv(sims: Simulator[]): string {
  const esc = (v: string | null | undefined): string => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CANONICAL_HEADER.join(",")];
  for (const s of sims) {
    lines.push(
      [
        s.easaCode,
        s.serialNumber,
        s.evalType,
        s.aircraftManufacturer,
        s.aircraftType,
        s.simManufacturer,
        s.qualification,
        s.location,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function targetCsvPath(): string {
  const candidates = [join(here, "..", "data", "simulators.csv"), join(process.cwd(), "src", "data", "simulators.csv")];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

const isMain =
  process.argv[1]?.endsWith("importSimulators.ts") || process.argv[1]?.endsWith("importSimulators.js");
if (isMain) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const srcPath = args.find((a) => !a.startsWith("--"));
  if (!srcPath) {
    console.error("Usage: tsx src/db/importSimulators.ts <easa-export.csv> [--check]");
    process.exitCode = 1;
  } else {
    const sims = fromEasaExport(readFileSync(srcPath, "utf8"));
    const report = validateSimulators(sims);
    console.log(`Parsed ${report.total} devices from ${srcPath}.`);
    if (report.coherencePct !== null) {
      console.log(`Code/location coherence: ${report.coherencePct.toFixed(1)}%`);
    }
    if (report.problems.length) {
      console.error("Validation problems:\n  - " + report.problems.join("\n  - "));
      process.exitCode = 1;
    } else if (checkOnly) {
      console.log("Looks aligned. (--check: not writing.)");
    } else {
      const out = targetCsvPath();
      writeFileSync(out, toCanonicalCsv(sims), "utf8");
      console.log(`Wrote ${report.total} devices to ${out}. Run: npm run seed:simulators`);
    }
  }
}
