/**
 * Declarative model of the attributes-and-endorsements section, grouped exactly
 * the way it appears in the form: per-category, per-group, per-sub-group.
 *
 * The form iterates this spec instead of hard-coding each item. Each `Item`
 * names an attribute key (the value stored in `attributes: string[]`) plus an
 * optional `input` describing what to render alongside the checkbox (a stepper,
 * an HH:MM, a segmented choice or a comment field). A few items also write to
 * a top-level entry field (`flightTimeMinutes`, `launchMethod`,
 * `balloonFlightType`) rather than to `attributeDetails`; those carry
 * `entryField: true` so the form's read/write path can route them.
 */

export type AttrCategory = "HELICOPTER" | "AEROPLANE" | "SAILPLANE" | "BALLOON";

export type AttrInput =
  | { kind: "count"; field: string; unit: string }
  | { kind: "time"; field: string; label: string; entryField?: boolean }
  | { kind: "segment"; field: string; options: ReadonlyArray<{ value: string; label: string }>; entryField?: boolean }
  | { kind: "text"; field: string; placeholder?: string };

export interface AttrItem {
  key: string;
  label: string;
  note?: string;
  /** Implicit-tick: when set, the item is considered "on" iff the entry's value
   * for this top-level field equals one of these strings. Used for the
   * tethered/free balloon flag, which lives on the entry, not in attributes. */
  entryToggle?: { field: string; whenValue: string };
  input?: AttrInput;
}

export interface AttrSubGroup {
  title: string;
  items: AttrItem[];
}

export interface AttrGroup {
  title: string;
  note?: string;
  subs?: AttrSubGroup[];
  items?: AttrItem[];
}

export interface AttrCategorySpec {
  category: AttrCategory;
  groups: AttrGroup[];
}

const SOLO: AttrItem = { key: "solo", label: "Solo", note: "Solo flight: pilot alone on board, no instructor or other crew." };
const CROSS_COUNTRY: AttrItem = {
  key: "cross_country",
  label: "Cross country",
  note: "A flight including a navigation leg of at least the distance required by Part-FCL.",
};
const SERIES_OF_FLIGHTS: AttrItem = {
  key: "series_of_flights",
  label: "Series of flights",
  note: "Several short flights of the same day recorded as one entry, with the total time optionally reduced. The 30-min between-flights cap applies (sailplanes excepted).",
  input: { kind: "time", field: "flightTimeMinutes", label: "reduced total time", entryField: true },
};

const SKILL_TEST: AttrItem = {
  key: "skill_test",
  label: "Skill test",
  note: "Initial issue of a licence, rating or endorsement (FCL.030).",
  input: { kind: "text", field: "skillTestComment", placeholder: "Comment" },
};
const PC: AttrItem = {
  key: "proficiency_check",
  label: "PC (proficiency check)",
  note: "Operator proficiency check (Part-ORO) - recurrent on type for commercial pilots.",
  input: { kind: "text", field: "proficiencyCheckComment", placeholder: "Comment" },
};
const LPC: AttrItem = {
  key: "licence_proficiency_check",
  label: "LPC (licence prof. check)",
  note: "Licence proficiency check (FCL.625, FCL.740) - revalidation of a class or type rating.",
  input: { kind: "text", field: "licenceProficiencyCheckComment", placeholder: "Comment" },
};
const LANG: AttrItem = {
  key: "language_proficiency_check",
  label: "Language proficiency",
  note: "Language proficiency reassessment (FCL.055).",
  input: { kind: "text", field: "languageProficiencyComment", placeholder: "Comment" },
};
const AOC: AttrItem = {
  key: "aoc",
  label: "AOC (assessment of competence)",
  note: "Assessment of competence (FCL.935) - instructor or examiner appraisal.",
  input: { kind: "text", field: "aocComment", placeholder: "Comment" },
};
const DEMO: AttrItem = {
  key: "demo_flight",
  label: "Demo flight",
  note: "A demonstration flight, typically with a potential student or passenger.",
  input: { kind: "text", field: "demoFlightComment", placeholder: "Comment" },
};

export const ATTR_SPEC: Record<AttrCategory, AttrCategorySpec> = {
  HELICOPTER: {
    category: "HELICOPTER",
    groups: [
      {
        title: "Takeoffs, landings & approach",
        note: "Tick each operation performed on this flight; enter the count below.",
        items: [
          {
            key: "hdf",
            label: "HDF (departure in fog)",
            note: "Helicopter Departure in Fog - a takeoff in low-visibility weather. Counts toward instrument recency for an IR(H).",
            input: { kind: "count", field: "hdfTakeoffs", unit: "takeoffs" },
          },
          {
            key: "mountain_landings",
            label: "Mountain landing",
            note: "Any landing in mountainous terrain (FOCA 2.2.3). Each landing is counted.",
            input: { kind: "count", field: "mountainLandings", unit: "landings" },
          },
          {
            key: "mountain_landing_official",
            label: "Mountain landing - official site",
            note: "A landing at an official Swiss mountain landing site (gebirgslandeplatz / place d'atterrissage en montagne).",
            input: { kind: "count", field: "mountainLandingsOfficial", unit: "landings" },
          },
          {
            key: "mountain_landing_2000",
            label: "Above 2 000 m",
            note: "Mountain landing performed above 2 000 m altitude.",
            input: { kind: "count", field: "mountainLandingsAbove2000", unit: "landings" },
          },
          {
            key: "mountain_landing_2700",
            label: "Above 2 700 m",
            note: "Mountain landing performed above 2 700 m altitude.",
            input: { kind: "count", field: "mountainLandingsAbove2700", unit: "landings" },
          },
        ],
      },
      {
        title: "Flights",
        items: [
          SOLO,
          CROSS_COUNTRY,
          SERIES_OF_FLIGHTS,
          {
            key: "nvis",
            label: "NVIS (night vision)",
            note: "Time flown using night-vision goggles. Appears in the remarks on the PDF. Cannot exceed the total flight time.",
            input: { kind: "time", field: "nvisMinutes", label: "flight time" },
          },
        ],
      },
      {
        title: "Load operations",
        subs: [
          {
            title: "HESLO - sling load (Part-SPO)",
            items: [
              { key: "heslo_1", label: "HESLO 1", note: "HESLO 1 - Class A external load: cargo close to ground, no overflight of populated areas.", input: { kind: "count", field: "heslo1Cycles", unit: "cycles" } },
              { key: "heslo_2", label: "HESLO 2", note: "HESLO 2 - Class B external load over populated / uninvolved areas.", input: { kind: "count", field: "heslo2Cycles", unit: "cycles" } },
              { key: "heslo_3", label: "HESLO 3", note: "HESLO 3 - Class C external load: precision placement / specialised cargo.", input: { kind: "count", field: "heslo3Cycles", unit: "cycles" } },
              { key: "heslo_4", label: "HESLO 4", note: "HESLO 4 - Class D external load: human external cargo with restricted dispatch.", input: { kind: "count", field: "heslo4Cycles", unit: "cycles" } },
            ],
          },
          {
            title: "HEC - human external cargo",
            items: [
              { key: "hec_1", label: "HEC 1", note: "HEC 1 - human external cargo, single-engine, day VFR limitations.", input: { kind: "count", field: "hec1Cycles", unit: "cycles" } },
              { key: "hec_2", label: "HEC 2", note: "HEC 2 - human external cargo, performance Class 2 with engine isolation.", input: { kind: "count", field: "hec2Cycles", unit: "cycles" } },
            ],
          },
          {
            title: "HHO - hoist",
            items: [
              { key: "hho", label: "HHO", note: "Helicopter Hoist Operation - winching crew or cargo on/off a static line.", input: { kind: "count", field: "hhoCycles", unit: "cycles" } },
            ],
          },
        ],
      },
      {
        title: "Additional checks",
        note: "Add a comment that describes the test or check. The entry is only creditable once countersigned.",
        items: [SKILL_TEST, PC, LPC, LANG],
      },
    ],
  },

  AEROPLANE: {
    category: "AEROPLANE",
    groups: [
      {
        title: "Takeoffs, landings & approach",
        items: [
          {
            key: "mountain_landings",
            label: "Mountain landing",
            note: "Landing in mountainous terrain. Pick the gear used.",
            input: { kind: "segment", field: "mountainLandingGear", options: [{ value: "SKI", label: "Skis" }, { value: "WHEELS", label: "Wheels" }] },
          },
          { key: "go_around", label: "Go-around", note: "A discontinued approach with a return to climb.", input: { kind: "count", field: "goArounds", unit: "go-arounds" } },
          { key: "touch_and_go", label: "Touch and go", note: "Repeated landing-then-takeoff without coming to a stop.", input: { kind: "count", field: "touchAndGo", unit: "cycles" } },
        ],
      },
      { title: "Flights", items: [SOLO, CROSS_COUNTRY, SERIES_OF_FLIGHTS] },
      {
        title: "Additional checks",
        note: "Add a comment that describes the test or check. The entry is only creditable once countersigned.",
        items: [SKILL_TEST, PC, LPC, LANG],
      },
    ],
  },

  SAILPLANE: {
    category: "SAILPLANE",
    groups: [
      { title: "Flights", items: [SOLO, CROSS_COUNTRY, SERIES_OF_FLIGHTS] },
      {
        title: "Additional checks",
        note: "Add a comment that describes the test or check.",
        items: [SKILL_TEST, PC, LPC, AOC, DEMO],
      },
      {
        title: "Training",
        items: [
          { key: "cloud_flying_privilege", label: "Cloud flying", note: "Flight in IMC under the cloud-flying privilege; requires the rating endorsement." },
          {
            key: "launch_privilege",
            label: "Launch method",
            note: "How the sailplane was launched on this flight (FOCA 2.2.5).",
            input: {
              kind: "segment",
              field: "launchMethod",
              entryField: true,
              options: [
                { value: "AEROTOW", label: "Aerotow" },
                { value: "WINCH", label: "Winch" },
                { value: "SELF_LAUNCH", label: "Self" },
                { value: "BUNGEE", label: "Bungee" },
                { value: "CAR_TOW", label: "Car" },
              ],
            },
          },
          {
            key: "aerobatic_privilege",
            label: "Aerobatic",
            note: "Aerobatic privilege level flown on this entry.",
            input: { kind: "segment", field: "aerobaticLevel", options: [{ value: "BASIC", label: "Basic" }, { value: "ADVANCED", label: "Advanced" }] },
          },
        ],
      },
    ],
  },

  BALLOON: {
    category: "BALLOON",
    groups: [
      {
        title: "Flights",
        items: [
          SOLO,
          CROSS_COUNTRY,
          SERIES_OF_FLIGHTS,
          {
            key: "tethered_flight",
            label: "Tethered flight",
            note: "A balloon flight tethered to the ground (BFCL.050).",
            entryToggle: { field: "balloonFlightType", whenValue: "TETHERED" },
          },
        ],
      },
      {
        title: "Additional checks",
        note: "Add a comment that describes the test or check.",
        items: [SKILL_TEST, PC, LPC, AOC],
      },
    ],
  },
};

/** Flatten every label from every spec for use by display code. */
export const ATTR_LABELS_FROM_SPEC: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const cat of Object.values(ATTR_SPEC)) {
    for (const g of cat.groups) {
      const items = [...(g.items ?? []), ...(g.subs ?? []).flatMap((s) => s.items)];
      for (const it of items) out[it.key] = it.label;
    }
  }
  return out;
})();
