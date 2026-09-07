/**
 * CSV bulk-import mapping for the self-service logbook importer.
 *
 * This is the pure, DB-free half of the feature: it turns a spreadsheet the
 * pilot filled in (see docs/import-template.csv) into the same
 * `NewEntryRequest`-shaped objects the Log-a-flight form produces, with a clear
 * per-field error whenever a cell is wrong. The endpoint (api/import/csv.ts)
 * then runs each mapped entry through the normal prepareFlightEntry pipeline,
 * so an imported flight is validated exactly like a hand-entered one.
 *
 * The aircraft type, engine class, category and multi-pilot flag are optional
 * in the file: when a cell is blank the endpoint fills it from the registration
 * (the reference database is authoritative for those anyway). The mapper marks
 * such a row with `needsAircraftLookup` and leaves the fields empty.
 *
 * Keeping the mapping here (rather than in the handler) means it can be unit
 * tested without a database and reused if a second surface ever needs it.
 */

export interface CsvIssue {
  field: string;
  message: string;
}

/** How the date column is written. "auto" asks the parser to detect it. */
export type DateFormat = "auto" | "YMD" | "DMY" | "MDY";

export interface MapOptions {
  /** Concrete date format to apply to every row (never "auto" at this point). */
  dateFormat: Exclude<DateFormat, "auto">;
  /**
   * The pilot's own name as it appears in the file's PIC column. Any pic_name
   * that matches (case-insensitively) is rewritten to "SELF", so a file that
   * carries the holder's real name on their own-PIC flights logs correctly
   * without disturbing the instructor names on dual flights.
   */
  selfName?: string | null;
}

/** The flight-entry body we hand to prepareFlightEntry, minus the pilot id. */
export interface MappedEntry {
  timeZone?: "UTC" | "LOCAL";
  aircraft: {
    /** Empty when it must be resolved from the registration. */
    makeModelVariant: string;
    registration: string;
    /** Empty when it must be resolved from the registration. */
    engineClass: "SE" | "ME" | "";
    /** Null when it must be resolved from the registration. */
    multiPilot: boolean | null;
    /** Empty when it must be resolved from the registration. */
    category: string;
  };
  legs: Array<{ departurePlace: string; departureTime: string; arrivalPlace: string; arrivalTime: string }>;
  picName: string;
  landings: { day: number; night: number };
  conditions: { night: number; ifr: number };
  function: { primary: string; instructor: number };
  remarks: string;
  attributes: string[];
}

export interface MappedRow {
  /** 1-based line number in the source file (the header is line 1). */
  line: number;
  externalId: string | null;
  /** A short human summary used by the preview even when the row is invalid. */
  summary: { date: string; route: string; aircraft: string; function: string };
  ok: boolean;
  /** True when one or more aircraft fields were blank and need registration lookup. */
  needsAircraftLookup: boolean;
  entry?: MappedEntry;
  issues?: CsvIssue[];
}

/** The columns the template ships with, in order. */
export const CSV_COLUMNS = [
  "external_id",
  "date",
  "off_block_utc",
  "on_block_utc",
  "departure_icao",
  "arrival_icao",
  "registration",
  "type",
  "engine_class",
  "multi_pilot",
  "category",
  "pic_name",
  "function",
  "day_landings",
  "night_landings",
  "night_minutes",
  "ifr_minutes",
  "instructor_minutes",
  "remarks",
  "attributes",
] as const;

// The aircraft columns (type, engine_class, multi_pilot, category) are NOT
// required: they are filled from the registration when omitted.
const REQUIRED_COLUMNS = [
  "date",
  "off_block_utc",
  "on_block_utc",
  "departure_icao",
  "arrival_icao",
  "registration",
  "function",
] as const;

const FUNCTIONS = ["PIC", "PICUS", "SPIC", "CO_PILOT", "DUAL", "SAFETY_PILOT"];
const CATEGORIES = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"];

/**
 * Minimal RFC-4180 CSV reader: quoted fields, embedded commas and newlines,
 * doubled "" escapes, and CRLF or LF line endings. Returns a matrix of raw
 * string cells. A trailing newline does not produce an empty final row, and a
 * leading UTF-8 BOM is stripped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // has the current row seen any content/field yet
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; started = false; };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === ",") { pushField(); started = true; continue; }
    if (ch === "\r") { continue; }
    if (ch === "\n") {
      if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); }
      continue;
    }
    field += ch;
    started = true;
  }
  if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const ICAO_RE = /^[A-Z]{4}$/;

/** Expand a 2- or 4-digit year. 2-digit uses a 1970 pivot (70-99 -> 19xx). */
function expandYear(y: string): number {
  const n = Number(y);
  if (y.length === 4) return n;
  if (y.length <= 2) return n >= 70 ? 1900 + n : 2000 + n;
  return n;
}

/**
 * Normalize a date cell to YYYY-MM-DD using the given field order. Accepts
 * "-", "/" and "." separators. Returns null when the value cannot be read as a
 * real calendar date in that order.
 */
export function normalizeDate(raw: string, format: Exclude<DateFormat, "auto">): string | null {
  const s = raw.trim();
  if (!s) return null;
  // A value already in ISO form is accepted regardless of the chosen format.
  if (ISO_DATE_RE.test(s)) {
    return isRealDate(s) ? s : null;
  }
  const parts = s.split(/[^0-9]+/).filter((p) => p.length > 0);
  if (parts.length !== 3) return null;
  let y: number, m: number, d: number;
  if (format === "YMD") {
    y = expandYear(parts[0]!); m = Number(parts[1]); d = Number(parts[2]);
  } else if (format === "DMY") {
    d = Number(parts[0]); m = Number(parts[1]); y = expandYear(parts[2]!);
  } else {
    m = Number(parts[0]); d = Number(parts[1]); y = expandYear(parts[2]!);
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}

function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Guess the date order from a column of samples. Returns a concrete format.
 * A 4-digit leading token means year-first; otherwise the tell is a first or
 * second token above 12. When nothing is decisive it defaults to day-first
 * (DMY), the European convention this logbook is used in.
 */
export function detectDateFormat(samples: string[]): Exclude<DateFormat, "auto"> {
  let yFirst = 0, yLast = 0, dayEvidence = 0, monthEvidence = 0;
  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    if (ISO_DATE_RE.test(s)) { yFirst++; continue; }
    const parts = s.split(/[^0-9]+/).filter((p) => p.length > 0);
    if (parts.length !== 3) continue;
    if (parts[0]!.length === 4) { yFirst++; continue; }
    if (parts[2]!.length === 4 || parts[2]!.length === 2) yLast++;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a > 12) dayEvidence++;
    if (b > 12) monthEvidence++;
  }
  if (yFirst > yLast) return "YMD";
  if (monthEvidence > 0 && dayEvidence === 0) return "MDY";
  return "DMY";
}

function normalizeTime(v: string): string | null {
  const m = TIME_RE.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseBool(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(t)) return true;
  if (["false", "no", "n", "0"].includes(t)) return false;
  return null;
}

function parseIntCell(v: string): number | null {
  const t = v.trim();
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/** yyyy-mm-dd -> the next calendar day, for flights that cross midnight. */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function splitAttributes(v: string): string[] {
  return v
    .split(/[\s;,]+/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * Map one already-parsed CSV data row into an entry, using the header order to
 * pick cells by name. Returns every problem it finds rather than stopping at the
 * first, so the pilot can fix a whole row in one pass.
 */
export function mapCsvRow(headers: string[], cells: string[], line: number, opts: MapOptions): MappedRow {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(normalizeHeader(h), i));
  const get = (name: string): string => {
    const i = idx.get(name);
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };

  const issues: CsvIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  const externalId = get("external_id") || null;
  const rawDate = get("date");
  const date = normalizeDate(rawDate, opts.dateFormat);
  const off = get("off_block_utc");
  const on = get("on_block_utc");
  const dep = get("departure_icao").toUpperCase();
  const arr = get("arrival_icao").toUpperCase();
  const registration = get("registration");
  const type = get("type");
  const engineRaw = get("engine_class").toUpperCase();
  const categoryRaw = get("category").toUpperCase();
  const multiRaw = get("multi_pilot");
  const fn = get("function").toUpperCase();

  const summary = {
    date: date ?? rawDate,
    route: `${dep || "?"} → ${arr || "?"}`,
    aircraft: [registration, type].filter(Boolean).join(" ") || registration || "?",
    function: fn,
  };

  if (date === null) add("date", `Date "${rawDate}" could not be read as ${opts.dateFormat}. Check the date format setting.`);
  const offN = normalizeTime(off);
  if (offN === null) add("off_block_utc", `Off-block time must be HH:MM 24-hour (got "${off}").`);
  const onN = normalizeTime(on);
  if (onN === null) add("on_block_utc", `On-block time must be HH:MM 24-hour (got "${on}").`);
  if (!ICAO_RE.test(dep)) add("departure_icao", `Departure must be 4 letters, or ZZZZ (got "${dep}").`);
  if (!ICAO_RE.test(arr)) add("arrival_icao", `Arrival must be 4 letters, or ZZZZ (got "${arr}").`);
  if (!registration) add("registration", "Registration is required.");

  // Aircraft descriptors are optional and default to registration lookup.
  let engineClass: "SE" | "ME" | "" = "";
  if (engineRaw) {
    if (engineRaw === "SE" || engineRaw === "ME") engineClass = engineRaw;
    else add("engine_class", `Engine class must be SE or ME, or left blank to fill from the registration (got "${engineRaw}").`);
  }
  let multiPilot: boolean | null = null;
  if (multiRaw) {
    const b = parseBool(multiRaw);
    if (b === null) add("multi_pilot", `Multi-pilot must be true or false, or left blank to fill from the registration (got "${multiRaw}").`);
    else multiPilot = b;
  }
  let category = "";
  if (categoryRaw) {
    if (CATEGORIES.includes(categoryRaw)) category = categoryRaw;
    else add("category", `Category must be one of ${CATEGORIES.join(", ")}, or left blank to fill from the registration (got "${categoryRaw}").`);
  }

  // pic_name: blank means the holder; a name matching the pilot's own name (as
  // it appears in the file) is normalized to SELF.
  let picName = get("pic_name");
  const self = (opts.selfName ?? "").trim().toLowerCase();
  if (!picName) picName = "SELF";
  else if (self && picName.trim().toLowerCase() === self) picName = "SELF";

  if (!FUNCTIONS.includes(fn)) add("function", `Function must be one of ${FUNCTIONS.join(", ")} (got "${fn}").`);

  const dayL = parseIntCell(get("day_landings"));
  if (dayL === null) add("day_landings", "Day landings must be a whole number.");
  const nightL = parseIntCell(get("night_landings"));
  if (nightL === null) add("night_landings", "Night landings must be a whole number.");
  const nightM = parseIntCell(get("night_minutes"));
  if (nightM === null) add("night_minutes", "Night minutes must be a whole number of minutes.");
  const ifrM = parseIntCell(get("ifr_minutes"));
  if (ifrM === null) add("ifr_minutes", "IFR minutes must be a whole number of minutes.");
  const instrM = parseIntCell(get("instructor_minutes"));
  if (instrM === null) add("instructor_minutes", "Instructor minutes must be a whole number of minutes.");

  const needsAircraftLookup = type === "" || engineClass === "" || multiPilot === null || category === "";

  if (issues.length > 0) {
    return { line, externalId, summary, ok: false, needsAircraftLookup, issues };
  }

  // Cross-midnight: an on-block that is not after the off-block rolls to the
  // next calendar day, matching how a pilot reads an overnight flight.
  const arrDate = onN! <= offN! ? nextDay(date!) : date!;

  const entry: MappedEntry = {
    aircraft: {
      makeModelVariant: type,
      registration,
      engineClass,
      multiPilot,
      category,
    },
    legs: [
      {
        departurePlace: dep,
        departureTime: `${date}T${offN}:00Z`,
        arrivalPlace: arr,
        arrivalTime: `${arrDate}T${onN}:00Z`,
      },
    ],
    picName,
    landings: { day: dayL!, night: nightL! },
    conditions: { night: nightM!, ifr: ifrM! },
    function: { primary: fn, instructor: instrM! },
    remarks: get("remarks"),
    attributes: splitAttributes(get("attributes")),
  };

  return { line, externalId, summary, ok: true, needsAircraftLookup, entry };
}

export interface ParsedCsv {
  /** Column headers as found (normalized names are matched case-insensitively). */
  headers: string[];
  rows: MappedRow[];
  /** The concrete date format that was applied (after auto-detection). */
  dateFormat: Exclude<DateFormat, "auto">;
  /** File-level problems that stop the import before any row is considered. */
  fatal: string | null;
}

/**
 * Parse a whole CSV file and map every data row. File-level problems (no
 * header, a missing required column, no data rows) come back as `fatal`. When
 * `dateFormat` is "auto" (the default) the order is detected from the date
 * column and reported back so the UI can show what was assumed.
 */
export function parseImportCsv(
  text: string,
  opts: { dateFormat?: DateFormat; selfName?: string | null } = {},
): ParsedCsv {
  const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const requested = opts.dateFormat ?? "auto";
  if (matrix.length === 0) {
    return { headers: [], rows: [], dateFormat: requested === "auto" ? "YMD" : requested, fatal: "The file is empty." };
  }
  const headers = matrix[0]!;
  const present = new Set(headers.map(normalizeHeader));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    return { headers, rows: [], dateFormat: requested === "auto" ? "YMD" : requested, fatal: `The file is missing required column(s): ${missing.join(", ")}. Start from the template.` };
  }
  if (matrix.length === 1) {
    return { headers, rows: [], dateFormat: requested === "auto" ? "YMD" : requested, fatal: "The file has a header row but no flights." };
  }

  const dateIdx = headers.map(normalizeHeader).indexOf("date");
  const dataRows = matrix.slice(1);
  const dateFormat: Exclude<DateFormat, "auto"> =
    requested === "auto"
      ? detectDateFormat(dataRows.map((r) => (dateIdx >= 0 ? r[dateIdx] ?? "" : "")))
      : requested;

  const rows = dataRows.map((cells, i) =>
    mapCsvRow(headers, cells, i + 2, { dateFormat, selfName: opts.selfName ?? null }),
  );
  return { headers, rows, dateFormat, fatal: null };
}
