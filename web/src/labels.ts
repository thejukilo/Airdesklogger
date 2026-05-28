/**
 * Human-readable labels for the coded values an entry carries. Kept in one place
 * so the form, the logbook list and the entry detail all read the same way.
 */

// FOCA 2.2.3 structured attributes, grouped for the entry form. `categories`
// limits an attribute to certain aircraft categories (launch is sailplane-only;
// HESLO/HEC are helicopter-only); an attribute with no `categories` applies to
// all. The flat ATTRIBUTES list and label map are derived from the groups.
export interface AttributeDef {
  key: string;
  label: string;
  categories?: string[];
  /** Optional explanatory note shown on hover. */
  note?: string;
}

export const ATTRIBUTE_GROUPS: Array<{ title: string; items: AttributeDef[] }> = [
  {
    title: "Tests / checks",
    items: [
      { key: "skill_test", label: "Skill test" },
      { key: "proficiency_check", label: "Proficiency check" },
      { key: "operator_proficiency_check", label: "Operator proficiency check" },
      { key: "operator_line_check", label: "Operator line check" },
      { key: "language_proficiency_check", label: "Language proficiency check" },
    ],
  },
  {
    title: "Training / operational",
    items: [
      { key: "refresher_training", label: "Refresher training" },
      { key: "training_flight", label: "Training flight" },
      { key: "familiarization", label: "Familiarisation" },
      { key: "difference_training", label: "Difference training" },
      { key: "zftt", label: "ZFTT" },
      { key: "course_completed", label: "Course completed" },
      { key: "instruction_training_course", label: "Instruction training course" },
      { key: "demonstration_of_ability_to_instruct", label: "Demo of ability to instruct" },
      { key: "solo", label: "Solo" },
      { key: "cross_country", label: "Cross country" },
      {
        key: "series_of_flights",
        label: "Series of flights",
        note: "Lets you record several short flights of the same day as one entry with a reduced total time. It applies when an aircraft makes repeated flights that each return to the same departure point and no more than 30 minutes elapses between them. The 30-minute gap limit does not apply to sailplane (SPL) licence holders.",
      },
      { key: "towing", label: "Towing" },
      { key: "heslo", label: "HESLO", categories: ["HELICOPTER"] },
      { key: "hec", label: "HEC", categories: ["HELICOPTER"] },
    ],
  },
  {
    title: "Privileges / environment",
    items: [
      { key: "aerobatic_privilege", label: "Aerobatic" },
      { key: "cloud_flying_privilege", label: "Cloud flying", categories: ["SAILPLANE"] },
      { key: "launch_privilege", label: "Launch privilege", categories: ["SAILPLANE"] },
    ],
  },
  {
    title: "Landings",
    items: [
      { key: "low_visibility_landing", label: "Low-visibility landing" },
      { key: "sea_landings", label: "Sea landing" },
      { key: "mountain_landings", label: "Mountain landing" },
    ],
  },
];

// Sailplanes support only this subset (must mirror the domain whitelist in
// src/domain/attributes.ts). For other categories the per-item `categories`
// field governs visibility instead.
export const SAILPLANE_ATTRIBUTES = new Set<string>([
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

/** Whether an attribute is offered for a given aircraft category. */
export function attributeAllowedForCategory(item: AttributeDef, category: string): boolean {
  if (category === "SAILPLANE") return SAILPLANE_ATTRIBUTES.has(item.key);
  return !item.categories || item.categories.includes(category);
}

// Attributes offered for a simulator session (tests/checks and coursework).
export const SIMULATOR_ATTRIBUTES = new Set<string>([
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
  "course_completed",
  "instruction_training_course",
]);

export const ATTRIBUTES: AttributeDef[] = ATTRIBUTE_GROUPS.flatMap((g) => g.items);

// Labels for the new spec-driven attribute keys introduced for the redesigned
// attributes section. Merged into ATTRIBUTE_LABELS below so the entry-detail
// page and the logbook chips read them out of one map.
const NEW_ATTRIBUTE_LABELS: Record<string, string> = {
  hdf: "HDF (departure in fog)",
  mountain_landing_official: "Mountain landing - official site",
  mountain_landing_2000: "Mountain landing - above 2 000 m",
  mountain_landing_2700: "Mountain landing - above 2 700 m",
  go_around: "Go-around",
  touch_and_go: "Touch and go",
  nvis: "NVIS (night vision)",
  tethered_flight: "Tethered flight",
  heslo_1: "HESLO 1",
  heslo_2: "HESLO 2",
  heslo_3: "HESLO 3",
  heslo_4: "HESLO 4",
  hec_1: "HEC 1",
  hec_2: "HEC 2",
  hho: "HHO",
  licence_proficiency_check: "LPC (licence prof. check)",
  aoc: "AOC (assessment of competence)",
  demo_flight: "Demo flight",
};

export const ATTRIBUTE_LABELS: Record<string, string> = {
  ...Object.fromEntries(ATTRIBUTES.map((a) => [a.key, a.label])),
  ...NEW_ATTRIBUTE_LABELS,
};

export const FUNCTION_LABELS: Record<string, string> = {
  PIC: "PIC",
  CO_PILOT: "Co-pilot",
  DUAL: "Dual",
  PICUS: "PICUS",
  SPIC: "SPIC",
  SAFETY_PILOT: "Safety pilot",
};

export const OPERATING_ROLE_LABELS: Record<string, string> = {
  PILOT_FLYING: "Pilot flying (PF)",
  PILOT_MONITORING: "Pilot monitoring (PM)",
};

export const CATEGORY_LABELS: Record<string, string> = {
  AEROPLANE: "Aeroplane",
  HELICOPTER: "Helicopter",
  SAILPLANE: "Sailplane",
  BALLOON: "Balloon",
};

export const LAUNCH_METHOD_LABELS: Record<string, string> = {
  WINCH: "Winch",
  AEROTOW: "Aerotow",
  SELF_LAUNCH: "Self-launch",
  BUNGEE: "Bungee",
  CAR_TOW: "Car tow",
};

export const INSTRUCTOR_POSITION_LABELS: Record<string, string> = {
  PILOT_SEAT: "Pilot seat",
  JUMP_SEAT: "Jump seat",
  SUPERVISING: "Supervising",
  EXAMINER: "Examiner",
};
