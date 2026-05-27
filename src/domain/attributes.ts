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
  "solo",
  "cross_country",
  "series_of_flights",
  "towing",
  "low_visibility_landing",
  "sea_landings",
  "mountain_landings",
  "heslo",
  "hec",
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
  heslo: ["HELICOPTER"],
  hec: ["HELICOPTER"],
};

/**
 * Sailplanes support only a specific subset of attributes (no operator checks,
 * ZFTT, low-visibility or sea landings). When the category is a sailplane this
 * whitelist applies instead of the per-attribute restrictions above.
 */
export const SAILPLANE_ATTRIBUTES: ReadonlySet<EntryAttribute> = new Set([
  "skill_test",
  "proficiency_check",
  "language_proficiency_check",
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
  "skill_test",
  "proficiency_check",
  "operator_proficiency_check",
  "operator_line_check",
  "language_proficiency_check",
]);

export function attributesRequiringSignature(
  attributes: readonly EntryAttribute[],
): EntryAttribute[] {
  return attributes.filter((a) => SIGNATURE_REQUIRED_ATTRIBUTES.has(a));
}

/** Whether an entry carrying these attributes needs a sign-off to be complete. */
export function requiresSignature(attributes: readonly EntryAttribute[]): boolean {
  return attributes.some((a) => SIGNATURE_REQUIRED_ATTRIBUTES.has(a));
}
