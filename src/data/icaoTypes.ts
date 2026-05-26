/**
 * ICAO Doc 8643 type description -> Part-FCL category.
 *
 * The designator table itself lives in the database (table icao_types, seeded
 * from icaoTypes.csv). This is the one business mapping that turns an ICAO
 * description into one of our four logbook categories:
 *
 *   LandPlane / SeaPlane / Amphibian    -> aeroplane
 *   Helicopter / Gyrocopter / Tiltrotor -> helicopter
 *   Balloon                             -> balloon
 *   Glider                              -> sailplane
 *
 * Kept pure (no database) so both the seed and the reference repository share
 * one definition and it can be unit tested in isolation.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";

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

/** Map an ICAO description to a category; an unrecognised one falls back to aeroplane. */
export function categoryForDescription(description: string): AircraftCategory {
  return DESCRIPTION_TO_CATEGORY[description.trim()] ?? "AEROPLANE";
}
