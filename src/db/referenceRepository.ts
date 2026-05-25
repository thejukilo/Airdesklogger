/**
 * Reference data: airports, aircraft and FSTD devices.
 *
 * FOCA 2.3.2 and 2.3.3 require these to be picked from a maintained database
 * rather than free-typed, so entries can be validated. This module provides the
 * lookups the validation needs and the upserts the reference endpoint uses to
 * load and maintain the data. The airport dataset is an operational concern (the
 * provider loads the ICAO list); the mechanism and the validation live here.
 */

import { getPool } from "./pool.js";
import { normalizeIcao } from "../domain/icao.js";

export interface Airport {
  icao: string;
  name: string;
  country?: string | null | undefined;
}

export async function upsertAirport(a: Airport): Promise<void> {
  await getPool().query(
    `INSERT INTO airports (icao, name, country) VALUES ($1,$2,$3)
       ON CONFLICT (icao) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country`,
    [normalizeIcao(a.icao), a.name, a.country ?? null],
  );
}

export async function airportExists(icao: string): Promise<boolean> {
  const { rows } = await getPool().query("SELECT 1 FROM airports WHERE icao = $1", [normalizeIcao(icao)]);
  return rows.length > 0;
}

export async function searchAirports(query: string, limit = 20): Promise<Airport[]> {
  const { rows } = await getPool().query(
    `SELECT icao, name, country FROM airports
      WHERE icao ILIKE $1 OR name ILIKE $1 ORDER BY icao LIMIT $2`,
    [`%${query}%`, limit],
  );
  return rows.map((r) => ({ icao: r.icao, name: r.name, country: r.country ?? null }));
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
    `SELECT * FROM aircraft WHERE registration = $1 AND valid_from <= $2::date
      ORDER BY valid_from DESC LIMIT 1`,
    [registration.toUpperCase(), onDate],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
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
  };
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
