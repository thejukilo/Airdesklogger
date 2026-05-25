/**
 * Human-readable labels for the coded values an entry carries. Kept in one place
 * so the form, the logbook list and the entry detail all read the same way.
 */

// FOCA 2.2.3 structured attributes, with friendly labels.
export const ATTRIBUTES: Array<{ key: string; label: string }> = [
  { key: "skill_test", label: "Skill test" },
  { key: "proficiency_check", label: "Proficiency check" },
  { key: "operator_proficiency_check", label: "Operator proficiency check" },
  { key: "operator_line_check", label: "Operator line check" },
  { key: "language_proficiency_check", label: "Language proficiency check" },
  { key: "cross_country", label: "Cross country" },
  { key: "solo", label: "Solo" },
  { key: "training_flight", label: "Training flight" },
  { key: "refresher_training", label: "Refresher training" },
  { key: "difference_training", label: "Difference training" },
  { key: "familiarization", label: "Familiarisation" },
  { key: "instruction_training_course", label: "Instruction training course" },
  { key: "demonstration_of_ability_to_instruct", label: "Demo of ability to instruct" },
  { key: "course_completed", label: "Course completed" },
  { key: "series_of_flights", label: "Series of flights" },
  { key: "zftt", label: "ZFTT" },
  { key: "aerobatic_privilege", label: "Aerobatic" },
  { key: "cloud_flying_privilege", label: "Cloud flying" },
  { key: "launch_privilege", label: "Launch privilege" },
  { key: "towing", label: "Towing" },
  { key: "low_visibility_landing", label: "Low-visibility landing" },
  { key: "sea_landings", label: "Sea landing" },
  { key: "mountain_landings", label: "Mountain landing" },
  { key: "heslo", label: "HESLO" },
  { key: "hec", label: "HEC" },
];

export const ATTRIBUTE_LABELS: Record<string, string> = Object.fromEntries(
  ATTRIBUTES.map((a) => [a.key, a.label]),
);

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
