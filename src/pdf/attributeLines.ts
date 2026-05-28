/**
 * Format an entry's structured attributes into rows for the attributes
 * appendix at the back of the PDF export. Each row is one attribute with a
 * label and a "detail" cell (the count, time, level or comment). NVIS is
 * excluded because it stays inline in the remarks cell.
 */

import type { AttributeDetails } from "../domain/types.js";

export interface AttributeRow {
  label: string;
  detail: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function formatAttributeRows(attributes: readonly string[], d?: AttributeDetails): AttributeRow[] {
  const rows: AttributeRow[] = [];
  const has = (k: string) => attributes.includes(k);
  const det = d ?? {};
  const push = (label: string, detail = "") => rows.push({ label, detail });

  if (has("hdf")) push("HDF (departure in fog)", det.hdfTakeoffs ? plural(det.hdfTakeoffs, "takeoff") : "");
  if (has("mountain_landings")) {
    const bits: string[] = [];
    if (det.mountainLandingGear) bits.push(det.mountainLandingGear === "SKI" ? "skis" : "wheels");
    if (det.mountainLandings) bits.push(plural(det.mountainLandings, "landing"));
    push("Mountain landing", bits.join(" - "));
  }
  if (has("mountain_landing_official"))
    push("Mountain landing - official site", det.mountainLandingsOfficial ? plural(det.mountainLandingsOfficial, "landing") : "");
  if (has("mountain_landing_2000"))
    push("Mountain landing > 2 000 m", det.mountainLandingsAbove2000 ? plural(det.mountainLandingsAbove2000, "landing") : "");
  if (has("mountain_landing_2700"))
    push("Mountain landing > 2 700 m", det.mountainLandingsAbove2700 ? plural(det.mountainLandingsAbove2700, "landing") : "");
  if (has("go_around")) push("Go-around", det.goArounds ? plural(det.goArounds, "go-around") : "");
  if (has("touch_and_go")) push("Touch and go", det.touchAndGo ? plural(det.touchAndGo, "cycle") : "");

  if (has("solo")) push("Solo");
  if (has("cross_country")) push("Cross country");
  if (has("series_of_flights")) push("Series of flights");
  if (has("tethered_flight")) push("Tethered flight");

  const cyc = (n: number | undefined) => (n ? plural(n, "cycle") : "");
  if (has("heslo_1")) push("HESLO 1", cyc(det.heslo1Cycles));
  if (has("heslo_2")) push("HESLO 2", cyc(det.heslo2Cycles));
  if (has("heslo_3")) push("HESLO 3", cyc(det.heslo3Cycles));
  if (has("heslo_4")) push("HESLO 4", cyc(det.heslo4Cycles));
  if (has("hec_1")) push("HEC 1", cyc(det.hec1Cycles));
  if (has("hec_2")) push("HEC 2", cyc(det.hec2Cycles));
  if (has("hho")) push("HHO", cyc(det.hhoCycles));

  if (has("cloud_flying_privilege")) push("Cloud flying privilege");
  if (has("launch_privilege")) push("Launch privilege");
  if (has("aerobatic_privilege")) push("Aerobatic", det.aerobaticLevel ? (det.aerobaticLevel === "BASIC" ? "basic" : "advanced") : "");

  if (has("skill_test")) push("Skill test", det.skillTestComment ?? "");
  if (has("proficiency_check")) push("PC (proficiency check)", det.proficiencyCheckComment ?? "");
  if (has("licence_proficiency_check")) push("LPC (licence proficiency check)", det.licenceProficiencyCheckComment ?? "");
  if (has("operator_proficiency_check")) push("OPC (operator proficiency check)");
  if (has("operator_line_check")) push("Operator line check");
  if (has("language_proficiency_check")) push("Language proficiency", det.languageProficiencyComment ?? "");
  if (has("aoc")) push("AOC (assessment of competence)", det.aocComment ?? "");
  if (has("demo_flight")) push("Demo flight", det.demoFlightComment ?? "");
  if (has("refresher_training")) push("Refresher training");
  if (has("difference_training")) push("Difference training");
  if (has("familiarization")) push("Familiarisation");
  if (has("course_completed")) push("Course completed");
  if (has("instruction_training_course")) push("Instruction training course");
  if (has("demonstration_of_ability_to_instruct")) push("Demo of ability to instruct");
  if (has("zftt")) push("ZFTT");
  if (has("towing")) push("Towing");
  if (has("low_visibility_landing")) push("Low-visibility landing", det.lowVisibilityLandingType ?? "");
  if (has("sea_landings")) push("Sea landing");

  // Legacy single-HESLO/HEC entries.
  if (has("heslo")) push(`HESLO ${det.hesloLevel ?? ""}`.trim(), det.hoistCycles ? plural(det.hoistCycles, "cycle") : "");
  if (has("hec")) push(`HEC ${det.hecLevel ?? ""}`.trim(), det.hoistCycles ? plural(det.hoistCycles, "cycle") : "");

  return rows;
}
