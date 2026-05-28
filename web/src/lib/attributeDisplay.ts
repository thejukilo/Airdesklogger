/**
 * Display helpers for the attribute chips that show up on the entry-detail page
 * and inside the inline logbook detail panel. Each new-spec attribute can carry
 * its own count, time, level or comment in attributeDetails; this helper formats
 * those as a short suffix to render after the attribute label.
 */

import type { AttributeDetails, EntryColumns } from "../api";

export function attributeChipSuffix(key: string, cols: EntryColumns | undefined): string {
  const d = cols?.attributeDetails as AttributeDetails | undefined;
  if (!d) return "";
  const n = (k: keyof AttributeDetails) => {
    const v = d[k] as number | undefined;
    return v && v > 0 ? ` × ${v}` : "";
  };
  const t = (k: keyof AttributeDetails) => {
    const v = d[k] as number | undefined;
    if (!v || v <= 0) return "";
    return ` ${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  };
  const c = (k: keyof AttributeDetails) => {
    const v = d[k] as string | undefined;
    return v ? ` — ${v}` : "";
  };
  switch (key) {
    case "hdf": return n("hdfTakeoffs");
    case "mountain_landings": {
      const gear = d.mountainLandingGear ? ` (${d.mountainLandingGear.toLowerCase()})` : "";
      return n("mountainLandings") + gear;
    }
    case "mountain_landing_official": return n("mountainLandingsOfficial");
    case "mountain_landing_2000": return n("mountainLandingsAbove2000");
    case "mountain_landing_2700": return n("mountainLandingsAbove2700");
    case "go_around": return n("goArounds");
    case "touch_and_go": return n("touchAndGo");
    case "nvis": return t("nvisMinutes");
    case "heslo_1": return n("heslo1Cycles");
    case "heslo_2": return n("heslo2Cycles");
    case "heslo_3": return n("heslo3Cycles");
    case "heslo_4": return n("heslo4Cycles");
    case "hec_1": return n("hec1Cycles");
    case "hec_2": return n("hec2Cycles");
    case "hho": return n("hhoCycles");
    case "aerobatic_privilege": return d.aerobaticLevel ? ` (${d.aerobaticLevel.toLowerCase()})` : "";
    case "skill_test": return c("skillTestComment");
    case "proficiency_check": return c("proficiencyCheckComment");
    case "licence_proficiency_check": return c("licenceProficiencyCheckComment");
    case "language_proficiency_check": return c("languageProficiencyComment");
    case "aoc": return c("aocComment");
    case "demo_flight": return c("demoFlightComment");
    default: return "";
  }
}
