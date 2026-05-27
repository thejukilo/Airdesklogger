/**
 * ICAO Doc 8643 type -> the Part-FCL categories it may be logged under.
 *
 * The designator table lives in the database (table icao_types, seeded from
 * icaoTypes.csv). A type's description (Landplane, Helicopter, Balloon, ...) and
 * its role (Glider, Motor-Glider, ...) decide the category. Most types map to a
 * single category, but a motor-glider (a TMG) may be logged as an aeroplane or a
 * sailplane, so a type can allow more than one. The first entry is the default.
 *
 *   role Glider                          -> sailplane
 *   role Motor-Glider                    -> aeroplane or sailplane
 *   Balloon                              -> balloon
 *   Helicopter / Gyrocopter / Tilt*      -> helicopter
 *   Landplane / Seaplane / Amphibian      -> aeroplane
 *
 * Kept pure (no database) so the seed and the reference repository share one
 * definition and it can be unit tested in isolation.
 */

import type { AircraftRecord } from "../db/referenceRepository.js";

type AircraftCategory = AircraftRecord["category"];

/** The categories an ICAO type may be logged under; the first is the default. */
export function allowedCategoriesForType(description: string, role: string | null | undefined): AircraftCategory[] {
  const r = (role ?? "").trim().toLowerCase();
  const d = (description ?? "").trim().toLowerCase();
  if (r === "motor-glider") return ["AEROPLANE", "SAILPLANE"];
  if (r === "glider") return ["SAILPLANE"];
  if (d === "balloon" || r === "balloon") return ["BALLOON"];
  if (d === "helicopter" || d === "gyrocopter" || d.startsWith("tilt")) return ["HELICOPTER"];
  // Landplane, seaplane, amphibian, or anything unrecognised.
  return ["AEROPLANE"];
}

/** The single default category for an ICAO type. */
export function defaultCategoryForType(description: string, role: string | null | undefined): AircraftCategory {
  return allowedCategoriesForType(description, role)[0]!;
}
