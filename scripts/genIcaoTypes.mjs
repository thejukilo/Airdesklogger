/**
 * Regenerate src/data/icaoTypes.generated.ts from src/data/icaoTypes.csv.
 *
 * The CSV is the ICAO Doc 8643 type designator list (one row per
 * manufacturer/model, many sharing a type code). We only need one entry per
 * type code, so we keep the first occurrence. The generated table maps a type
 * designator to its ICAO description (LandPlane, Helicopter, Balloon, ...) plus
 * engine type and count, which the aircraft lookup uses to classify the
 * Part-FCL category and prefill the engine fields.
 *
 *   node scripts/genIcaoTypes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, "..", "src", "data", "icaoTypes.csv");
const outPath = join(here, "..", "src", "data", "icaoTypes.generated.ts");

const lines = readFileSync(csvPath, "utf8").split(/\r?\n/);
const table = {};
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const [, , typeRaw, descRaw, engineRaw, countRaw] = line.split(",");
  const code = (typeRaw ?? "").trim().toUpperCase();
  const description = (descRaw ?? "").trim();
  if (!code || !description || code in table) continue;
  const row = { description };
  const engine = (engineRaw ?? "").trim();
  if (engine && engine !== "-") row.engine = engine;
  const count = Number((countRaw ?? "").trim());
  if (Number.isInteger(count) && count > 0) row.engineCount = count;
  table[code] = row;
}

const keys = Object.keys(table).sort();
const body = keys
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`)
  .join("\n");

const out = `// AUTO-GENERATED from src/data/icaoTypes.csv by scripts/genIcaoTypes.mjs.
// Do not edit by hand; run \`npm run gen:icao-types\` to regenerate.
export interface IcaoTypeRow {
  description: string;
  engine?: string;
  engineCount?: number;
}

export const ICAO_TYPE_TABLE: Record<string, IcaoTypeRow> = {
${body}
};
`;

writeFileSync(outPath, out);
console.log(`Wrote ${keys.length} type designators to ${outPath}`);
