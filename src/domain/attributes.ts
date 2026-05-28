/**
 * Structured entry attributes required by FOCA "Accepted Logbook Formats" 2.2.3.
 *
 * The authority requires these to be recorded as structured values, not buried in
 * free text, so they can be evaluated for licence and endorsement eligibility.
 * The list below is taken directly from 2.2.3. Some of them (a check or a test)
 * are not creditable without a sign-off; FOCA 2.4.6 requires an export to flag an
 * entry that needs a signature but does not have one, so we name that subset here.
 */

import type { AircraftCategory } from "./types.js";

export const ENTRY_ATTRIBUTES = [
  "skill_test",
  "proficiency_check",
  "operator_proficiency_check",
  "operator_line_check",
  "licence_proficiency_check",
  "language_proficiency_check",
  "refresher_training",
  "training_flight",
  "familiarization",
  "difference_training",
  "zftt",
  "aerobatic_privilege",
  "launch_privilege",
  "cloud_flying_privilege",
  "course_completed",
  "instruction_training_course",
  "demonstration_of_ability_to_instruct",
  "aoc",
  "demo_flight",
  "solo",
  "cross_country",
  "series_of_flights",
  "towing",
  "low_visibility_landing",
  "sea_landings",
  "mountain_landings",
  "mountain_landing_official",
  "mountain_landing_2000",
  "mountain_landing_2700",
  "hdf",
  "go_around",
  "touch_and_go",
  "nvis",
  "tethered_flight",
  "heslo",
  "heslo_1",
  "heslo_2",
  "heslo_3",
  "heslo_4",
  "hec",
  "hec_1",
  "hec_2",
  "hho",
] as const;

export type EntryAttribute = (typeof ENTRY_ATTRIBUTES)[number];

/**
 * Attributes that only make sense for some aircraft categories: a launch
 * privilege is a sailplane endorsement, and HESLO (sling load) and HEC (human
 * external cargo) are helicopter operations. Anything not listed applies to all.
 */
export const ATTRIBUTE_CATEGORY_RESTRICTIONS: Partial<Record<EntryAttribute, readonly AircraftCategory[]>> = {
  launch_privilege: ["SAILPLANE"],
  cloud_flying_privilege: ["SAILPLANE"],
  demo_flight: ["SAILPLANE"],
  tethered_flight: ["BALLOON"],
  heslo: ["HELICOPTER"],
  heslo_1: ["HELICOPTER"],
  heslo_2: ["HELICOPTER"],
  heslo_3: ["HELICOPTER"],
  heslo_4: ["HELICOPTER"],
  hec: ["HELICOPTER"],
  hec_1: ["HELICOPTER"],
  hec_2: ["HELICOPTER"],
  hho: ["HELICOPTER"],
  hdf: ["HELICOPTER"],
  nvis: ["HELICOPTER"],
  mountain_landing_official: ["HELICOPTER"],
  mountain_landing_2000: ["HELICOPTER"],
  mountain_landing_2700: ["HELICOPTER"],
  go_around: ["AEROPLANE"],
  touch_and_go: ["AEROPLANE"],
  aoc: ["SAILPLANE", "BALLOON"],
};

/**
 * Sailplanes support only a specific subset of attributes (no operator checks,
 * ZFTT, low-visibility or sea landings). When the category is a sailplane this
 * whitelist applies instead of the per-attribute restrictions above.
 */
export const SAILPLANE_ATTRIBUTES: ReadonlySet<EntryAttribute> = new Set([
  "skill_test",
  "proficiency_check",
  "licence_proficiency_check",
  "language_proficiency_check",
  "aoc",
  "demo_flight",
  "refresher_training",
  "training_flight",
  "familiarization",
  "difference_training",
  "course_completed",
  "instruction_training_course",
  "demonstration_of_ability_to_instruct",
  "solo",
  "cross_country",
  "series_of_flights",
  "towing",
  "aerobatic_privilege",
  "cloud_flying_privilege",
  "launch_privilege",
  "mountain_landings",
]);

/** Whether an attribute may be used for an aircraft of the given category. */
export function attributeAllowedForCategory(attr: EntryAttribute, category: AircraftCategory): boolean {
  if (category === "SAILPLANE") return SAILPLANE_ATTRIBUTES.has(attr);
  const allowed = ATTRIBUTE_CATEGORY_RESTRICTIONS[attr];
  return !allowed || allowed.includes(category);
}

const ATTRIBUTE_SET: ReadonlySet<string> = new Set(ENTRY_ATTRIBUTES);

export function isEntryAttribute(value: string): value is EntryAttribute {
  return ATTRIBUTE_SET.has(value);
}

/** The checks and tests that are only creditable once countersigned. */
export const SIGNATURE_REQUIRED_ATTRIBUTES: ReadonlySet<EntryAttribute> = new Set([
  // Tests and checks performed against an examiner / ATO / DTO.
  "skill_test",
  "proficiency_check",
  "licence_proficiency_check",
  "operator_proficiency_check",
  "operator_line_check",
  "language_proficiency_check",
  "aoc",
  // Recurrent / differences training, signed off by the instructor.
  "refresher_training",
  "difference_training",
  "familiarization",
  // Course completion, signed off by the head of training or an ATO/DTO.
  "course_completed",
  "instruction_training_course",
]);

/** A primary function that, regardless of attributes, demands a sign-off:
 *  DUAL needs the flight instructor, PICUS and SPIC need the supervising PIC.
 *  PIC, CO_PILOT and SAFETY_PILOT never require one. */
const SIGNATURE_REQUIRED_FUNCTIONS: ReadonlySet<string> = new Set(["DUAL", "PICUS", "SPIC"]);

export function attributesRequiringSignature(
  attributes: readonly EntryAttribute[],
): EntryAttribute[] {
  return attributes.filter((a) => SIGNATURE_REQUIRED_ATTRIBUTES.has(a));
}

/** Whether an entry needs a sign-off to be complete. The pilot's primary
 * function (DUAL, PICUS, SPIC) drives a required signature on its own; certain
 * attributes (tests, checks, recurrent training) also do, irrespective of the
 * function. A flight logged as PIC or co-pilot with no such attribute is
 * complete as-is. */
export function requiresSignature(
  attributes: readonly EntryAttribute[],
  primaryFunction?: string,
): boolean {
  if (primaryFunction && SIGNATURE_REQUIRED_FUNCTIONS.has(primaryFunction)) return true;
  return attributes.some((a) => SIGNATURE_REQUIRED_ATTRIBUTES.has(a));
}
