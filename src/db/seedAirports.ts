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
  latitude: number | null;
  longitude: number | null;
}

const BUILTIN: SeedAirport[] = [
  { icao: "LSZH", name: "Zurich", country: "CH", latitude: 47.4647, longitude: 8.5492 },
  { icao: "LSGG", name: "Geneva", country: "CH", latitude: 46.2381, longitude: 6.1089 },
  { icao: "LSZB", name: "Bern-Belp", country: "CH", latitude: 46.9141, longitude: 7.4971 },
  { icao: "LSZA", name: "Lugano", country: "CH", latitude: 46.0043, longitude: 8.9106 },
  { icao: "LSZR", name: "St. Gallen-Altenrhein", country: "CH", latitude: 47.485, longitude: 9.5608 },
  { icao: "LSZS", name: "Samedan", country: "CH", latitude: 46.5341, longitude: 9.8841 },
  { icao: "EGLL", name: "London Heathrow", country: "GB", latitude: 51.4706, longitude: -0.4619 },
  { icao: "EGKB", name: "London Biggin Hill", country: "GB", latitude: 51.3308, longitude: 0.0325 },
  { icao: "EGMC", name: "Southend", country: "GB", latitude: 51.5714, longitude: 0.6956 },
  { icao: "EGSS", name: "London Stansted", country: "GB", latitude: 51.885, longitude: 0.235 },
  { icao: "EGGW", name: "London Luton", country: "GB", latitude: 51.8747, longitude: -0.3683 },
  { icao: "EGKK", name: "London Gatwick", country: "GB", latitude: 51.1481, longitude: -0.1903 },
  { icao: "EGBJ", name: "Gloucestershire", country: "GB", latitude: 51.8942, longitude: -2.1672 },
  { icao: "LFPG", name: "Paris Charles de Gaulle", country: "FR", latitude: 49.0097, longitude: 2.5479 },
  { icao: "LFAT", name: "Le Touquet", country: "FR", latitude: 50.5174, longitude: 1.6206 },
  { icao: "LFAC", name: "Calais-Dunkerque", country: "FR", latitude: 50.9621, longitude: 1.9547 },
  { icao: "EDDF", name: "Frankfurt", country: "DE", latitude: 50.0333, longitude: 8.5706 },
  { icao: "EDDM", name: "Munich", country: "DE", latitude: 48.3538, longitude: 11.7861 },
  { icao: "LIRF", name: "Rome Fiumicino", country: "IT", latitude: 41.8003, longitude: 12.2389 },
  { icao: "LEMD", name: "Madrid Barajas", country: "ES", latitude: 40.4719, longitude: -3.5626 },
  { icao: "EHAM", name: "Amsterdam Schiphol", country: "NL", latitude: 52.3086, longitude: 4.7639 },
  { icao: "LOWW", name: "Vienna", country: "AT", latitude: 48.1103, longitude: 16.5697 },
  { icao: "KLAX", name: "Los Angeles", country: "US", latitude: 33.9425, longitude: -118.408 },
  { icao: "KJFK", name: "New York JFK", country: "US", latitude: 40.6398, longitude: -73.7789 },
];

/** Minimal CSV reader that handles quoted fields and escaped quotes. */
export function parseCsv(text: string): string[][] {
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
  const latCol = header.indexOf("latitude_deg");
  const lonCol = header.indexOf("longitude_deg");
  if (identCol === -1 || nameCol === -1) {
    throw new Error("CSV does not look like the OurAirports format (missing ident/name columns).");
  }
  const num = (v: string | undefined): number | null => {
    const n = Number((v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const out: SeedAirport[] = [];
  for (const r of rows) {
    const icao = (r[identCol] ?? "").trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(icao)) continue;
    out.push({
      icao,
      name: (r[nameCol] ?? "").trim() || icao,
      country: countryCol === -1 ? null : (r[countryCol] ?? "").trim() || null,
      latitude: latCol === -1 ? null : num(r[latCol]),
      longitude: lonCol === -1 ? null : num(r[lonCol]),
    });
  }
  return out;
}

async function upsertBatch(airports: SeedAirport[]): Promise<number> {
  const pool = getPool();
  let written = 0;
  const CHUNK = 2000; // 5 params per row, well under the parameter limit
  for (let i = 0; i < airports.length; i += CHUNK) {
    const chunk = airports.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((a, j) => {
      const b = j * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      params.push(a.icao, a.name, a.country, a.latitude, a.longitude);
    });
    await pool.query(
      `INSERT INTO airports (icao, name, country, latitude, longitude) VALUES ${values.join(",")}
         ON CONFLICT (icao) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
           latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
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
