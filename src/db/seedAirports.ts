/**
 * Loads airports into the reference database.
 *
 * FOCA expects the provider to maintain the airport data. The canonical free
 * source is the OurAirports dataset (https://ourairports.com/data/airports.csv),
 * which carries the ICAO identifier, name and country for essentially every
 * aerodrome. Run with a path to that CSV to load the full set:
 *
 *   npm run seed:airports -- ./airports.csv
 *
 * With no path, a small built-in starter set is loaded so a fresh install is
 * immediately usable. Only rows with a four-letter ICAO identifier are taken;
 * the no-location indicator ZZZZ is handled by validation, not stored here.
 */

import { readFileSync } from "node:fs";
import { getPool, closePool } from "./pool.js";

interface SeedAirport {
  icao: string;
  name: string;
  country: string | null;
}

const BUILTIN: SeedAirport[] = [
  { icao: "LSZH", name: "Zurich", country: "CH" },
  { icao: "LSGG", name: "Geneva", country: "CH" },
  { icao: "LSZB", name: "Bern-Belp", country: "CH" },
  { icao: "LSZA", name: "Lugano", country: "CH" },
  { icao: "LSZR", name: "St. Gallen-Altenrhein", country: "CH" },
  { icao: "LSZS", name: "Samedan", country: "CH" },
  { icao: "EGLL", name: "London Heathrow", country: "GB" },
  { icao: "EGKB", name: "London Biggin Hill", country: "GB" },
  { icao: "EGMC", name: "Southend", country: "GB" },
  { icao: "EGSS", name: "London Stansted", country: "GB" },
  { icao: "EGGW", name: "London Luton", country: "GB" },
  { icao: "EGKK", name: "London Gatwick", country: "GB" },
  { icao: "EGBJ", name: "Gloucestershire", country: "GB" },
  { icao: "LFPG", name: "Paris Charles de Gaulle", country: "FR" },
  { icao: "LFAT", name: "Le Touquet", country: "FR" },
  { icao: "LFAC", name: "Calais-Dunkerque", country: "FR" },
  { icao: "EDDF", name: "Frankfurt", country: "DE" },
  { icao: "EDDM", name: "Munich", country: "DE" },
  { icao: "LIRF", name: "Rome Fiumicino", country: "IT" },
  { icao: "LEMD", name: "Madrid Barajas", country: "ES" },
  { icao: "EHAM", name: "Amsterdam Schiphol", country: "NL" },
  { icao: "LOWW", name: "Vienna", country: "AT" },
  { icao: "KLAX", name: "Los Angeles", country: "US" },
  { icao: "KJFK", name: "New York JFK", country: "US" },
];

/** Minimal CSV reader that handles quoted fields and escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function fromOurAirportsCsv(text: string): SeedAirport[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return [];
  const identCol = header.indexOf("ident");
  const nameCol = header.indexOf("name");
  const countryCol = header.indexOf("iso_country");
  if (identCol === -1 || nameCol === -1) {
    throw new Error("CSV does not look like the OurAirports format (missing ident/name columns).");
  }
  const out: SeedAirport[] = [];
  for (const r of rows) {
    const icao = (r[identCol] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(icao)) continue;
    out.push({
      icao,
      name: (r[nameCol] ?? "").trim() || icao,
      country: countryCol === -1 ? null : (r[countryCol] ?? "").trim() || null,
    });
  }
  return out;
}

async function upsertBatch(airports: SeedAirport[]): Promise<number> {
  const pool = getPool();
  let written = 0;
  const CHUNK = 4000; // 3 params per row, well under the parameter limit
  for (let i = 0; i < airports.length; i += CHUNK) {
    const chunk = airports.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((a, j) => {
      const b = j * 3;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
      params.push(a.icao, a.name, a.country);
    });
    await pool.query(
      `INSERT INTO airports (icao, name, country) VALUES ${values.join(",")}
         ON CONFLICT (icao) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country`,
      params,
    );
    written += chunk.length;
  }
  return written;
}

/** Bulk-upsert a list of airports. Exposed for the on-demand import endpoint. */
export async function upsertAirports(airports: SeedAirport[]): Promise<number> {
  return upsertBatch(airports);
}

export async function seedAirports(csvPath?: string): Promise<number> {
  const airports = csvPath ? fromOurAirportsCsv(readFileSync(csvPath, "utf8")) : BUILTIN;
  return upsertBatch(airports);
}

const isMain = process.argv[1]?.endsWith("seedAirports.ts") || process.argv[1]?.endsWith("seedAirports.js");
if (isMain) {
  const path = process.argv[2];
  seedAirports(path)
    .then((n) => {
      console.log(`Seeded ${n} airports${path ? ` from ${path}` : " (built-in starter set)"}.`);
      return closePool();
    })
    .catch((err) => {
      console.error("Airport seed failed:", err);
      process.exitCode = 1;
      return closePool();
    });
}
