/**
 * capzlog.aero CSV import mapping.
 *
 * capzlog exports one report per aircraft category (Airplane, Helicopter,
 * Sailplane, Balloon) plus a Simulator report, each with its own column layout.
 * This module detects which report a file is and maps every row into the same
 * internal shapes the Airdesk importer already understands (MappedRow with a
 * flight `entry` or an FSTD `fstd`), so the endpoint runs them through the exact
 * same validation and creation pipeline as a hand-entered flight.
 *
 * Key differences from the Airdesk template, handled here:
 *  - Dates/times are one "M/D/YYYY H:MM" value per off-/on-block, US order.
 *  - Durations are "H:MM" strings (block time, night, IFR, instructor, ...).
 *  - The aircraft type, engine class, category and multi-pilot are known from
 *    the file, so each flight carries an aircraftSeed and the endpoint registers
 *    the aircraft before validating (a migrated aircraft need not be pre-added).
 *  - Balloon departure/arrival are place names, not ICAO codes (as EASA allows).
 *  - The Simulator report maps to an FSTD session, not a flight.
 *
 * Pure and DB-free so it can be unit tested; the endpoint owns all persistence.
 */

import type {
  CsvIssue,
  MappedRow,
  MappedEntry,
  MappedFstd,
  AircraftSeed,
} from "./importCsv.js";

export type CapzlogReport = "airplane" | "helicopter" | "sailplane" | "balloon" | "simulator";

const REPORT_CATEGORY: Record<Exclude<CapzlogReport, "simulator">, AircraftSeed["category"]> = {
  airplane: "AEROPLANE",
  helicopter: "HELICOPTER",
  sailplane: "SAILPLANE",
  balloon: "BALLOON",
};

// ---------------------------------------------------------------------------
// CSV reading (shares the parser shape used by the template importer).
// ---------------------------------------------------------------------------
function parseMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; started = false; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === ",") { pushField(); started = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); } continue; }
    field += ch; started = true;
  }
  if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function norm(h: string): string {
  return h.trim().toLowerCase();
}

/**
 * Identify a capzlog report from its header row. The Airplane and Helicopter
 * reports share an identical layout, so a file with the engine columns is
 * reported as "airplane" and the caller (who knows which report they exported)
 * can override to "helicopter".
 */
export function detectCapzlogReport(headers: string[]): CapzlogReport | null {
  const set = new Set(headers.map(norm));
  if (set.has("session time")) return "simulator";
  if (set.has("launch method")) return "sailplane";
  if (set.has("single engine") && set.has("off block")) return "airplane";
  if (set.has("pic name") && set.has("off block")) return "balloon";
  return null;
}

// ---------------------------------------------------------------------------
// Value parsing.
// ---------------------------------------------------------------------------
const DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const HHMM_RE = /^(\d{1,4}):([0-5]\d)$/;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "M/D/YYYY H:MM" -> "YYYY-MM-DDTHH:MM:00Z" (a wall-clock instant). */
export function parseCapzlogDateTime(raw: string): string | null {
  const m = DATETIME_RE.exec(raw.trim());
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]), y = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00Z`;
}

/** "M/D/YYYY" -> "YYYY-MM-DD". */
export function parseCapzlogDate(raw: string): string | null {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

/** "H:MM" -> minutes. Blank is 0; a malformed value is null. */
export function parseHhmm(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return 0;
  const m = HHMM_RE.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseCount(raw: string): number {
  const s = raw.trim();
  return /^\d+$/.test(s) ? Number(s) : 0;
}

/** Map a capzlog pilot-function label to an Airdesk primary function. */
function mapFunction(raw: string): string | null {
  const f = raw.trim().toLowerCase();
  if (f === "pic" || f === "commander") return "PIC";
  if (f === "picus") return "PICUS";
  if (f === "spic") return "SPIC";
  if (f === "dual") return "DUAL";
  if (["copi", "copilot", "co-pilot", "co pilot", "cop"].includes(f)) return "CO_PILOT";
  if (["instructor", "fi", "instr"].includes(f)) return "PIC"; // an instructor logs PIC + instructor time
  if (["safety", "safety pilot"].includes(f)) return "SAFETY_PILOT";
  return null;
}

function mapLaunch(raw: string): string | undefined {
  const l = raw.trim().toLowerCase();
  if (l === "winch") return "WINCH";
  if (["aerotow", "aero tow", "aero-tow"].includes(l)) return "AEROTOW";
  if (["self", "self launch", "self-launch"].includes(l)) return "SELF_LAUNCH";
  if (l === "bungee") return "BUNGEE";
  if (["car", "car tow", "car-tow"].includes(l)) return "CAR_TOW";
  return undefined;
}

function selfOrName(raw: string, selfName?: string | null): string {
  const v = raw.trim();
  if (!v || v.toLowerCase() === "self") return "SELF";
  const self = (selfName ?? "").trim().toLowerCase();
  if (self && v.toLowerCase() === self) return "SELF";
  return v;
}

type Getter = (name: string) => string;

/** Build attributes + detail counts from the capzlog manoeuvre/operation columns. */
function flightAttributes(get: Getter): { attributes: string[]; details: Record<string, number> } {
  const attributes: string[] = [];
  const details: Record<string, number> = {};
  const add = (col: string, attr: string, detailKey?: string) => {
    const n = parseCount(get(col));
    if (n > 0) {
      attributes.push(attr);
      if (detailKey) details[detailKey] = n;
    }
  };
  add("go arounds", "go_around", "goArounds");
  add("touch and goes", "touch_and_go", "touchAndGo");
  add("mountain landings", "mountain_landings", "mountainLandings");
  add("mountain landings > 2000m", "mountain_landing_2000", "mountainLandingsAbove2000");
  add("mountain landings > 2700m", "mountain_landing_2700", "mountainLandingsAbove2700");
  add("sea landings", "sea_landings");
  add("heslo1 cycles", "heslo_1", "heslo1Cycles");
  add("heslo2 cycles", "heslo_2", "heslo2Cycles");
  add("heslo3 cycles", "heslo_3", "heslo3Cycles");
  add("heslo4 cycles", "heslo_4", "heslo4Cycles");
  add("hec1 cycles", "hec_1", "hec1Cycles");
  add("hec2 cycles", "hec_2", "hec2Cycles");
  add("hho cycles", "hho", "hhoCycles");
  return { attributes, details };
}

// ---------------------------------------------------------------------------
// Row mappers.
// ---------------------------------------------------------------------------
function mapFlightRow(
  get: Getter,
  line: number,
  report: Exclude<CapzlogReport, "simulator">,
  selfName?: string | null,
): MappedRow {
  const category = REPORT_CATEGORY[report];
  const isBalloon = report === "balloon";
  const hasEngineCols = report === "airplane" || report === "helicopter";

  const issues: CsvIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  const depRaw = get("departure");
  const arrRaw = get("arrival");
  const dep = isBalloon ? depRaw : depRaw.toUpperCase();
  const arr = isBalloon ? arrRaw : arrRaw.toUpperCase();
  const offRaw = get("off block");
  const onRaw = get("on block");
  const registration = get("aircraft");
  const modelCode = get("model"); // ICAO-ish designator, e.g. A210, G2CA, GLID, BALL-H
  const typeText = get("type");   // human model on the sailplane report, e.g. "ASG 32"
  const fnRaw = get("pilot function");

  const off = parseCapzlogDateTime(offRaw);
  const on = parseCapzlogDateTime(onRaw);
  const dateStr = off ? off.slice(0, 10) : (parseCapzlogDate(offRaw.split(" ")[0] ?? "") ?? offRaw);

  const summary = {
    date: dateStr,
    route: `${dep || "?"} → ${arr || "?"}`,
    aircraft: [registration, typeText || modelCode].filter(Boolean).join(" ") || registration || "?",
    function: fnRaw.toUpperCase(),
  };

  if (!dep) add("departure", "Departure is required.");
  if (!arr) add("arrival", "Arrival is required.");
  if (off === null) add("off block", `Off block "${offRaw}" is not a valid M/D/YYYY H:MM value.`);
  if (on === null) add("on block", `On block "${onRaw}" is not a valid M/D/YYYY H:MM value.`);
  if (!registration) add("aircraft", "Aircraft registration is required.");

  const primary = mapFunction(fnRaw);
  if (primary === null) add("pilot function", `Unrecognised pilot function "${fnRaw}".`);

  const instr = parseHhmm(get("instructor"));
  if (instr === null) add("instructor", `Instructor time "${get("instructor")}" is not H:MM.`);

  let engineClass: "SE" | "ME" = "SE";
  if (hasEngineCols) {
    const me = parseHhmm(get("multi engine"));
    if (me === null) add("multi engine", `Multi engine "${get("multi engine")}" is not H:MM.`);
    else engineClass = me > 0 ? "ME" : "SE";
  }
  const multiPilot = hasEngineCols ? (parseHhmm(get("multi pilot")) ?? 0) > 0 : false;

  // Landings: airplane/helicopter split day/night; sailplane/balloon are day.
  let dayL = 0, nightL = 0;
  if (hasEngineCols) {
    dayL = parseCount(get("day landings"));
    nightL = parseCount(get("night landings"));
    if (dayL === 0 && nightL === 0) dayL = parseCount(get("landings"));
  } else {
    dayL = parseCount(get("landings"));
  }

  const night = hasEngineCols ? (parseHhmm(get("night")) ?? 0) : 0;
  const ifr = hasEngineCols ? (parseHhmm(get("ifr")) ?? 0) : 0;

  const picName = selfOrName(get("pic name"), selfName);
  const launchMethod = report === "sailplane" ? mapLaunch(get("launch method")) : undefined;
  const { attributes, details } = hasEngineCols ? flightAttributes(get) : { attributes: [], details: {} };

  if (issues.length > 0) {
    return { line, externalId: null, summary, ok: false, kind: "FLIGHT", needsAircraftLookup: false, issues };
  }

  const humanModel = typeText || modelCode || registration;
  const aircraftSeed: AircraftSeed = {
    registration,
    model: humanModel,
    ...(modelCode ? { icaoType: modelCode } : {}),
    category,
    engineClass,
    multiPilot,
  };

  const entry: MappedEntry = {
    aircraft: { makeModelVariant: humanModel, registration, engineClass, multiPilot, category },
    legs: [{ departurePlace: dep, departureTime: off!, arrivalPlace: arr, arrivalTime: on! }],
    picName,
    landings: { day: dayL, night: nightL },
    conditions: { night, ifr },
    function: { primary: primary!, instructor: instr! },
    remarks: get("remark"),
    attributes,
    ...(launchMethod ? { launchMethod } : {}),
    ...(Object.keys(details).length > 0 ? { attributeDetails: details } : {}),
  };

  return { line, externalId: null, summary, ok: true, kind: "FLIGHT", needsAircraftLookup: false, aircraftSeed, entry };
}

function mapSimulatorRow(get: Getter, line: number): MappedRow {
  const issues: CsvIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  const dateRaw = get("date");
  const date = parseCapzlogDate(dateRaw);
  const deviceType = get("model");
  const qualificationNumber = get("aircraft");
  const total = parseHhmm(get("session time"));
  const fnRaw = get("pilot function").trim().toLowerCase();
  const pilotFunction = fnRaw === "trainee" ? "TRAINEE" : fnRaw.startsWith("sfi") || fnRaw.startsWith("sfe") ? "SFI_SFE" : undefined;

  const summary = {
    date: date ?? dateRaw,
    route: `FSTD ${deviceType || "?"}`,
    aircraft: [qualificationNumber, deviceType].filter(Boolean).join(" ") || "?",
    function: pilotFunction ?? fnRaw.toUpperCase(),
  };

  if (date === null) add("date", `Date "${dateRaw}" is not a valid M/D/YYYY value.`);
  if (!deviceType) add("model", "Model (device type) is required.");
  if (!qualificationNumber) add("aircraft", "Aircraft (device id) is required.");
  if (total === null) add("session time", `Session time "${get("session time")}" is not H:MM.`);
  else if (total <= 0) add("session time", "Session time must be greater than zero.");

  if (issues.length > 0) {
    return { line, externalId: null, summary, ok: false, kind: "FSTD", needsAircraftLookup: false, issues };
  }

  const attributes: string[] = [];
  if (parseCount(get("go arounds")) > 0) attributes.push("go_around");
  if (parseCount(get("touch and goes")) > 0) attributes.push("touch_and_go");

  const fstd: MappedFstd = {
    deviceType,
    qualificationNumber,
    ...(pilotFunction ? { pilotFunction } : {}),
    instruction: "",
    date: `${date}T00:00:00Z`,
    totalMinutes: total!,
    remarks: get("remark"),
    attributes,
  };

  return { line, externalId: null, summary, ok: true, kind: "FSTD", needsAircraftLookup: false, fstd };
}

export interface ParsedCapzlog {
  report: CapzlogReport;
  rows: MappedRow[];
  fatal: string | null;
}

/**
 * Parse a whole capzlog CSV. `reportType` forces which report to read (the
 * caller usually knows, since capzlog exports one file per category); when
 * omitted it is detected from the header. A layout that does not match the
 * chosen report comes back as `fatal`.
 */
export function parseCapzlogCsv(
  text: string,
  opts: { reportType?: CapzlogReport; selfName?: string | null } = {},
): ParsedCapzlog {
  const matrix = parseMatrix(text);
  const fallbackReport = opts.reportType ?? "airplane";
  if (matrix.length === 0) return { report: fallbackReport, rows: [], fatal: "The file is empty." };

  const headers = matrix[0]!;
  const detected = detectCapzlogReport(headers);
  const report = opts.reportType ?? detected;
  if (!report) {
    return { report: fallbackReport, rows: [], fatal: "This does not look like a capzlog.aero export (unrecognised columns)." };
  }

  // Sanity-check the header matches the chosen report.
  const set = new Set(headers.map(norm));
  const need = (cols: string[]) => cols.filter((c) => !set.has(c));
  const missing =
    report === "simulator" ? need(["date", "session time", "aircraft", "model"])
    : report === "sailplane" ? need(["off block", "on block", "aircraft", "launch method"])
    : need(["off block", "on block", "aircraft", "pilot function"]);
  if (missing.length > 0) {
    return { report, rows: [], fatal: `This file does not have the expected capzlog ${report} columns (missing: ${missing.join(", ")}).` };
  }
  if (matrix.length === 1) {
    return { report, rows: [], fatal: "The file has a header row but no flights." };
  }

  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(norm(h), i));
  const rows = matrix.slice(1).map((cells, i) => {
    const get: Getter = (name) => {
      const j = idx.get(name);
      return j === undefined ? "" : (cells[j] ?? "").trim();
    };
    return report === "simulator"
      ? mapSimulatorRow(get, i + 2)
      : mapFlightRow(get, i + 2, report, opts.selfName ?? null);
  });
  return { report, rows, fatal: null };
}
