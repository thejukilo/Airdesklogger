/**
 * Reference data: airports, aircraft and FSTD devices.
 *
 * FOCA 2.3.2 and 2.3.3 require these to be picked from a maintained database
 * rather than free-typed, so entries can be validated. This module provides the
 * lookups the validation needs and the upserts the reference endpoint uses to
 * load and maintain the data. The airport dataset is an operational concern (the
 * provider loads the ICAO list); the mechanism and the validation live here.
 */

import { getPool, withTransaction } from "./pool.js";
import { normalizeIcao } from "../domain/icao.js";
import { allowedCategoriesForType } from "../data/icaoTypes.js";
import { timezoneAt } from "../http/timezone.js";

export interface Airport {
  icao: string;
  name: string;
  country?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  /** IANA timezone derived from coordinates; null when coords are missing. */
  timezone?: string | null | undefined;
}

export async function upsertAirport(a: Airport): Promise<void> {
  await getPool().query(
    `INSERT INTO airports (icao, name, country, latitude, longitude) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (icao) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
         latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
    [normalizeIcao(a.icao), a.name, a.country ?? null, a.latitude ?? null, a.longitude ?? null],
  );
}

export async function airportExists(icao: string): Promise<boolean> {
  const { rows } = await getPool().query("SELECT 1 FROM airports WHERE icao = $1", [normalizeIcao(icao)]);
  return rows.length > 0;
}

/** Coordinates for an airport, used to compute night time. Null when unknown. */
export async function getAirportCoords(
  icao: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const { rows } = await getPool().query(
    "SELECT latitude, longitude FROM airports WHERE icao = $1",
    [normalizeIcao(icao)],
  );
  const r = rows[0];
  if (!r || r.latitude === null || r.longitude === null) return null;
  return { latitude: Number(r.latitude), longitude: Number(r.longitude) };
}

export async function searchAirports(query: string, limit = 20): Promise<Airport[]> {
  const { rows } = await getPool().query(
    `SELECT icao, name, country, latitude, longitude FROM airports
      WHERE icao ILIKE $1 OR name ILIKE $1 ORDER BY icao LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows.map((r) => {
    const lat = r.latitude !== null ? Number(r.latitude) : null;
    const lon = r.longitude !== null ? Number(r.longitude) : null;
    return {
      icao: r.icao,
      name: r.name,
      country: r.country ?? null,
      latitude: lat,
      longitude: lon,
      timezone: lat !== null && lon !== null ? timezoneAt(lat, lon) : null,
    };
  });
}

export interface AircraftRecord {
  registration: string;
  model: string;
  icaoType?: string | undefined;
  variant?: string | undefined;
  category: "AEROPLANE" | "HELICOPTER" | "SAILPLANE" | "BALLOON";
  engineType?: string | undefined;
  engineCount?: number | undefined;
  multiPilot?: boolean | undefined;
  balloonGroup?: string | undefined;
  validFrom?: string | undefined;
}

export async function upsertAircraft(a: AircraftRecord): Promise<string> {
  const { rows } = await getPool().query(
    `INSERT INTO aircraft
       (registration, model, icao_type, variant, category, engine_type, engine_count, multi_pilot, balloon_group, valid_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::date, '1970-01-01'))
     ON CONFLICT (registration, valid_from) DO UPDATE SET
       model = EXCLUDED.model, icao_type = EXCLUDED.icao_type, variant = EXCLUDED.variant,
       category = EXCLUDED.category, engine_type = EXCLUDED.engine_type, engine_count = EXCLUDED.engine_count,
       multi_pilot = EXCLUDED.multi_pilot, balloon_group = EXCLUDED.balloon_group
     RETURNING id`,
    [
      a.registration.toUpperCase(),
      a.model,
      a.icaoType ?? null,
      a.variant ?? null,
      a.category,
      a.engineType ?? null,
      a.engineCount ?? null,
      a.multiPilot ?? false,
      a.balloonGroup ?? null,
      a.validFrom ?? null,
    ],
  );
  return rows[0].id as string;
}

/** The aircraft record for a registration current on or before the given date. */
export async function getAircraftForFlight(
  registration: string,
  onDate: string,
): Promise<AircraftRecord | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM aircraft
       WHERE regexp_replace(upper(registration), '[^A-Z0-9]', '', 'g') = $1
         AND valid_from <= $2::date
      ORDER BY valid_from DESC LIMIT 1`,
    [normalizeRegistration(registration), onDate],
  );
  if (!rows[0]) return null;
  return mapAircraftRow(rows[0]);
}

/**
 * Canonical key for registration matching: uppercase, no dashes, no spaces.
 * "HB-PNT", "hb-pnt", and "HBPNT" all collapse to "HBPNT" for lookup, while
 * the stored row's dashed form is what we return as the canonical display
 * value.
 */
export function normalizeRegistration(registration: string): string {
  return registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function mapAircraftRow(r: Record<string, unknown>): AircraftRecord {
  return {
    registration: r.registration as string,
    model: r.model as string,
    icaoType: (r.icao_type as string) ?? undefined,
    variant: (r.variant as string) ?? undefined,
    category: r.category as AircraftRecord["category"],
    engineType: (r.engine_type as string) ?? undefined,
    engineCount: (r.engine_count as number) ?? undefined,
    multiPilot: r.multi_pilot as boolean,
    balloonGroup: (r.balloon_group as string) ?? undefined,
    validFrom: String(r.valid_from).slice(0, 10),
  };
}

/** The most recent aircraft record for a registration, regardless of date. */
export async function getAircraftByRegistration(registration: string): Promise<AircraftRecord | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM aircraft
       WHERE regexp_replace(upper(registration), '[^A-Z0-9]', '', 'g') = $1
       ORDER BY valid_from DESC LIMIT 1`,
    [normalizeRegistration(registration)],
  );
  return rows[0] ? mapAircraftRow(rows[0]) : null;
}

export async function listAircraft(query: string, limit = 50): Promise<AircraftRecord[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM aircraft WHERE registration ILIKE $1 OR model ILIKE $1
      ORDER BY registration, valid_from DESC LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows.map((r) => ({
    registration: r.registration,
    model: r.model,
    icaoType: r.icao_type ?? undefined,
    variant: r.variant ?? undefined,
    category: r.category,
    engineType: r.engine_type ?? undefined,
    engineCount: r.engine_count ?? undefined,
    multiPilot: r.multi_pilot,
    balloonGroup: r.balloon_group ?? undefined,
    validFrom: String(r.valid_from).slice(0, 10),
  }));
}

export interface IcaoTypeInfo {
  /** The ICAO Doc 8643 description, shown to the pilot as the precise subtype. */
  description: string;
  /** A representative model name for the type, or null. */
  aircraftModel: string | null;
  /** The role (e.g. Glider, Motor-Glider), or null. */
  role: string | null;
  /** The default category for the type (the first allowed one). */
  category: AircraftRecord["category"];
  /** Every category the type may be logged under (a motor-glider allows two). */
  allowedCategories: AircraftRecord["category"][];
  engineType?: string | undefined;
  engineCount?: number | undefined;
}

export interface IcaoTypeSeed {
  code: string;
  description: string;
  aircraftModel?: string | null | undefined;
  role?: string | null | undefined;
  engineType?: string | null | undefined;
  engineCount?: number | null | undefined;
}

/** Classify an ICAO type designator from the reference table, or null if absent. */
export async function getIcaoType(code: string): Promise<IcaoTypeInfo | null> {
  const { rows } = await getPool().query(
    "SELECT description, aircraft_model, role, engine_type, engine_count FROM icao_types WHERE code = $1",
    [code.trim().toUpperCase()],
  );
  const r = rows[0];
  if (!r) return null;
  const allowed = allowedCategoriesForType(r.description as string, r.role as string | null);
  return {
    description: r.description as string,
    aircraftModel: (r.aircraft_model as string) ?? null,
    role: (r.role as string) ?? null,
    category: allowed[0]!,
    allowedCategories: allowed,
    engineType: (r.engine_type as string) ?? undefined,
    engineCount: r.engine_count === null ? undefined : Number(r.engine_count),
  };
}

function insertIcaoTypes(
  query: (text: string, params: unknown[]) => Promise<unknown>,
  types: IcaoTypeSeed[],
): Promise<unknown[]> {
  const CHUNK = 1000; // 6 params per row, well under the parameter limit
  const batches: Promise<unknown>[] = [];
  for (let i = 0; i < types.length; i += CHUNK) {
    const chunk = types.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((t, j) => {
      const b = j * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(t.code.toUpperCase(), t.description, t.aircraftModel ?? null, t.role ?? null, t.engineType ?? null, t.engineCount ?? null);
    });
    batches.push(
      query(
        `INSERT INTO icao_types (code, description, aircraft_model, role, engine_type, engine_count) VALUES ${values.join(",")}
           ON CONFLICT (code) DO UPDATE SET
             description = EXCLUDED.description, aircraft_model = EXCLUDED.aircraft_model, role = EXCLUDED.role,
             engine_type = EXCLUDED.engine_type, engine_count = EXCLUDED.engine_count`,
        params,
      ),
    );
  }
  return Promise.all(batches);
}

/** Bulk-upsert ICAO type designators. Used by the integration tests. */
export async function upsertIcaoTypes(types: IcaoTypeSeed[]): Promise<number> {
  const pool = getPool();
  await insertIcaoTypes((text, params) => pool.query(text, params), types);
  return types.length;
}

/** Replace the entire ICAO type table with the given set, atomically. */
export async function replaceIcaoTypes(types: IcaoTypeSeed[]): Promise<number> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM icao_types");
    await insertIcaoTypes((text, params) => client.query(text, params), types);
  });
  return types.length;
}

export interface FstdDevice {
  qualificationNumber: string;
  deviceKind: "FNPT_I" | "FNPT_II" | "FTD" | "FFS" | "BITD" | "OTHER";
  level?: string | undefined;
  aircraftType?: string | undefined;
}

export async function upsertFstdDevice(d: FstdDevice): Promise<void> {
  await getPool().query(
    `INSERT INTO fstd_devices (qualification_number, device_kind, level, aircraft_type)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (qualification_number) DO UPDATE SET
       device_kind = EXCLUDED.device_kind, level = EXCLUDED.level, aircraft_type = EXCLUDED.aircraft_type`,
    [d.qualificationNumber, d.deviceKind, d.level ?? null, d.aircraftType ?? null],
  );
}

export async function fstdDeviceExists(qualificationNumber: string): Promise<boolean> {
  const { rows } = await getPool().query(
    "SELECT 1 FROM fstd_devices WHERE qualification_number = $1",
    [qualificationNumber],
  );
  return rows.length > 0;
}

export interface Simulator {
  id?: string | undefined;
  easaCode: string;
  serialNumber?: string | null | undefined;
  aircraftType?: string | null | undefined;
  qualification?: string | null | undefined;
  evalType?: string | null | undefined;
  aircraftManufacturer?: string | null | undefined;
  simManufacturer?: string | null | undefined;
  location?: string | null | undefined;
}

function mapSimulatorRow(r: Record<string, unknown>): Simulator {
  return {
    id: r.id as string,
    easaCode: r.easa_code as string,
    serialNumber: (r.serial_number as string) ?? null,
    aircraftType: (r.aircraft_type as string) ?? null,
    qualification: (r.qualification as string) ?? null,
    evalType: (r.eval_type as string) ?? null,
    aircraftManufacturer: (r.aircraft_manufacturer as string) ?? null,
    simManufacturer: (r.sim_manufacturer as string) ?? null,
    location: (r.location as string) ?? null,
  };
}

/** Autocomplete simulators by EASA code or serial number. */
export async function searchSimulators(query: string, limit = 20): Promise<Simulator[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM simulators
       WHERE easa_code ILIKE $1 OR serial_number ILIKE $1
       ORDER BY easa_code LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows.map(mapSimulatorRow);
}

/** Add a single simulator (the "not found, add it" path), returning its id. */
export async function addSimulator(s: Simulator): Promise<string> {
  const { rows } = await getPool().query(
    `INSERT INTO simulators
       (easa_code, serial_number, aircraft_type, qualification, eval_type, aircraft_manufacturer, sim_manufacturer, location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      s.easaCode,
      s.serialNumber ?? null,
      s.aircraftType ?? null,
      s.qualification ?? null,
      s.evalType ?? null,
      s.aircraftManufacturer ?? null,
      s.simManufacturer ?? null,
      s.location ?? null,
    ],
  );
  return rows[0].id as string;
}

function insertSimulators(
  query: (text: string, params: unknown[]) => Promise<unknown>,
  sims: Simulator[],
): Promise<unknown[]> {
  const CHUNK = 1000; // 8 params per row
  const batches: Promise<unknown>[] = [];
  for (let i = 0; i < sims.length; i += CHUNK) {
    const chunk = sims.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((s, j) => {
      const b = j * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(
        s.easaCode,
        s.serialNumber ?? null,
        s.aircraftType ?? null,
        s.qualification ?? null,
        s.evalType ?? null,
        s.aircraftManufacturer ?? null,
        s.simManufacturer ?? null,
        s.location ?? null,
      );
    });
    batches.push(
      query(
        `INSERT INTO simulators
           (easa_code, serial_number, aircraft_type, qualification, eval_type, aircraft_manufacturer, sim_manufacturer, location)
         VALUES ${values.join(",")}`,
        params,
      ),
    );
  }
  return Promise.all(batches);
}

/** Replace the entire simulator table with the given set, atomically (the seed). */
export async function replaceSimulators(sims: Simulator[]): Promise<number> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM simulators");
    await insertSimulators((text, params) => client.query(text, params), sims);
  });
  return sims.length;
}
