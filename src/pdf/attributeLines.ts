/**
 * Format an entry's structured attributes into human-readable lines for the
 * attributes appendix at the back of the export. Each line is one attribute
 * (HESLO 1 - 4 cycles, Skill test - "IR(H) initial", etc.). NVIS is excluded
 * because it stays in the remarks cell.
 */

import type { AttributeDetails } from "../domain/types.js";

function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatAttributeLines(attributes: readonly string[], d?: AttributeDetails): string[] {
  const lines: string[] = [];
  const has = (k: string) => attributes.includes(k);
  const det = d ?? {};

  if (has("hdf")) lines.push(`HDF (departure in fog)${det.hdfTakeoffs ? ` - ${det.hdfTakeoffs} takeoff${det.hdfTakeoffs === 1 ? "" : "s"}` : ""}`);
  if (has("mountain_landings")) {
    const gear = det.mountainLandingGear ? ` - ${det.mountainLandingGear === "SKI" ? "skis" : "wheels"}` : "";
    const n = det.mountainLandings ? ` - ${det.mountainLandings} landing${det.mountainLandings === 1 ? "" : "s"}` : "";
    lines.push(`Mountain landing${gear}${n}`);
  }
  if (has("mountain_landing_official"))
    lines.push(`Mountain landing - official site${det.mountainLandingsOfficial ? ` - ${det.mountainLandingsOfficial} landing${det.mountainLandingsOfficial === 1 ? "" : "s"}` : ""}`);
  if (has("mountain_landing_2000"))
    lines.push(`Mountain landing > 2 000 m${det.mountainLandingsAbove2000 ? ` - ${det.mountainLandingsAbove2000} landing${det.mountainLandingsAbove2000 === 1 ? "" : "s"}` : ""}`);
  if (has("mountain_landing_2700"))
    lines.push(`Mountain landing > 2 700 m${det.mountainLandingsAbove2700 ? ` - ${det.mountainLandingsAbove2700} landing${det.mountainLandingsAbove2700 === 1 ? "" : "s"}` : ""}`);
  if (has("go_around")) lines.push(`Go-around${det.goArounds ? ` - ${det.goArounds}` : ""}`);
  if (has("touch_and_go")) lines.push(`Touch and go${det.touchAndGo ? ` - ${det.touchAndGo} cycle${det.touchAndGo === 1 ? "" : "s"}` : ""}`);

  if (has("solo")) lines.push("Solo");
  if (has("cross_country")) lines.push("Cross country");
  if (has("series_of_flights")) lines.push("Series of flights");
  if (has("tethered_flight")) lines.push("Tethered flight");

  const cyc = (n: number | undefined) => (n ? ` - ${n} cycle${n === 1 ? "" : "s"}` : "");
  if (has("heslo_1")) lines.push(`HESLO 1${cyc(det.heslo1Cycles)}`);
  if (has("heslo_2")) lines.push(`HESLO 2${cyc(det.heslo2Cycles)}`);
  if (has("heslo_3")) lines.push(`HESLO 3${cyc(det.heslo3Cycles)}`);
  if (has("heslo_4")) lines.push(`HESLO 4${cyc(det.heslo4Cycles)}`);
  if (has("hec_1")) lines.push(`HEC 1${cyc(det.hec1Cycles)}`);
  if (has("hec_2")) lines.push(`HEC 2${cyc(det.hec2Cycles)}`);
  if (has("hho")) lines.push(`HHO${cyc(det.hhoCycles)}`);

  if (has("cloud_flying_privilege")) lines.push("Cloud flying privilege");
  if (has("launch_privilege")) lines.push("Launch privilege");
  if (has("aerobatic_privilege")) lines.push(`Aerobatic${det.aerobaticLevel ? ` - ${det.aerobaticLevel === "BASIC" ? "basic" : "advanced"}` : ""}`);

  const cmt = (s: string | undefined) => (s ? ` - ${s}` : "");
  if (has("skill_test")) lines.push(`Skill test${cmt(det.skillTestComment)}`);
  if (has("proficiency_check")) lines.push(`PC (proficiency check)${cmt(det.proficiencyCheckComment)}`);
  if (has("licence_proficiency_check")) lines.push(`LPC (licence proficiency check)${cmt(det.licenceProficiencyCheckComment)}`);
  if (has("language_proficiency_check")) lines.push(`Language proficiency${cmt(det.languageProficiencyComment)}`);
  if (has("aoc")) lines.push(`AOC (assessment of competence)${cmt(det.aocComment)}`);
  if (has("demo_flight")) lines.push(`Demo flight${cmt(det.demoFlightComment)}`);

  // Legacy keys that may still appear on old entries.
  if (has("heslo")) lines.push(`HESLO ${det.hesloLevel ?? ""}${det.hoistCycles ? ` - ${det.hoistCycles} cycles` : ""}`.trim());
  if (has("hec")) lines.push(`HEC ${det.hecLevel ?? ""}${det.hoistCycles ? ` - ${det.hoistCycles} cycles` : ""}`.trim());
  if (det.lowVisibilityLandingType) lines.push(`Low-visibility landing - ${det.lowVisibilityLandingType}`);

  return lines;
}
