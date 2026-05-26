/**
 * ICAO type designator lookup.
 *
 * adsbdb tells us a registration's ICAO type designator (e.g. PC12, EC35, BALL)
 * but not which Part-FCL category it belongs to. The ICAO Doc 8643 list (loaded
 * from icaoTypes.csv into icaoTypes.generated.ts) classifies every designator
 * with a description, which maps onto our four logbook categories:
 *
 *   LandPlane / SeaPlane / Amphibian   -> aeroplane
 *   Helicopter / Gyrocopter / Tiltrotor -> helicopter
 *   Balloon                             -> balloon
 *   Glider                              -> sailplane
 *
 * The description is the precise "subtype" we show the pilot; only the mapped
 * category is recorded in the log.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";
import { ICAO_TYPE_TABLE } from "./icaoTypes.generated.js";

type AircraftCategory = AircraftRecord["category"];

const DESCRIPTION_TO_CATEGORY: Record<string, AircraftCategory> = {
  LandPlane: "AEROPLANE",
  SeaPlane: "AEROPLANE",
  Amphibian: "AEROPLANE",
  Helicopter: "HELICOPTER",
  Gyrocopter: "HELICOPTER",
  Tiltrotor: "HELICOPTER",
  Balloon: "BALLOON",
  Glider: "SAILPLANE",
};

export interface IcaoTypeInfo {
  /** The ICAO Doc 8643 description, shown as the subtype (e.g. "Helicopter"). */
  description: string;
  category: AircraftCategory;
  engineType?: string;
  engineCount?: number;
}

/** Classify an ICAO type designator, or null when it is not in the list. */
export function lookupIcaoType(code: string | undefined | null): IcaoTypeInfo | null {
  if (!code) return null;
  const row = ICAO_TYPE_TABLE[code.trim().toUpperCase()];
  if (!row) return null;
  const info: IcaoTypeInfo = {
    description: row.description,
    category: DESCRIPTION_TO_CATEGORY[row.description] ?? "AEROPLANE",
  };
  if (row.engine) info.engineType = row.engine;
  if (row.engineCount) info.engineCount = row.engineCount;
  return info;
}
