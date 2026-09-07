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
 * Keeping the mapping here (rather than in the handler) means it can be unit
 * tested without a database and reused if a second surface ever needs it.
 */

export interface CsvIssue {
  field: string;
  message: string;
}

/** The flight-entry body we hand to prepareFlightEntry, minus the pilot id. */
export interface MappedEntry {
  timeZone?: "UTC" | "LOCAL";
  aircraft: {
    makeModelVariant: string;
    registration: string;
    engineClass: "SE" | "ME";
    multiPilot: boolean;
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

const REQUIRED_COLUMNS = [
  "date",
  "off_block_utc",
  "on_block_utc",
  "departure_icao",
  "arrival_icao",
  "registration",
  "type",
  "engine_class",
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
      // Only emit a row if the line had any content or explicit fields.
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const ICAO_RE = /^[A-Z]{4}$/;

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
  if (["false", "no", "n", "0", ""].includes(t)) return false;
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
export function mapCsvRow(headers: string[], cells: string[], line: number): MappedRow {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(normalizeHeader(h), i));
  const get = (name: string): string => {
    const i = idx.get(name);
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };

  const issues: CsvIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });

  const externalId = get("external_id") || null;
  const date = get("date");
  const off = get("off_block_utc");
  const on = get("on_block_utc");
  const dep = get("departure_icao").toUpperCase();
  const arr = get("arrival_icao").toUpperCase();
  const registration = get("registration");
  const type = get("type");
  const engineRaw = get("engine_class").toUpperCase();
  const categoryRaw = get("category").toUpperCase();
  const fn = get("function").toUpperCase();

  const summary = {
    date,
    route: `${dep || "?"} → ${arr || "?"}`,
    aircraft: [registration, type].filter(Boolean).join(" ") || "?",
    function: fn,
  };

  if (!DATE_RE.test(date)) add("date", `Date must be YYYY-MM-DD (got "${date}").`);
  const offN = normalizeTime(off);
  if (offN === null) add("off_block_utc", `Off-block time must be HH:MM 24-hour (got "${off}").`);
  const onN = normalizeTime(on);
  if (onN === null) add("on_block_utc", `On-block time must be HH:MM 24-hour (got "${on}").`);
  if (!ICAO_RE.test(dep)) add("departure_icao", `Departure must be 4 letters, or ZZZZ (got "${dep}").`);
  if (!ICAO_RE.test(arr)) add("arrival_icao", `Arrival must be 4 letters, or ZZZZ (got "${arr}").`);
  if (!registration) add("registration", "Registration is required.");
  if (!type) add("type", "Aircraft type is required.");
  if (engineRaw !== "SE" && engineRaw !== "ME") add("engine_class", `Engine class must be SE or ME (got "${engineRaw}").`);

  const multiPilot = parseBool(get("multi_pilot"));
  if (multiPilot === null) add("multi_pilot", `Multi-pilot must be true or false (got "${get("multi_pilot")}").`);

  const category = categoryRaw || "AEROPLANE";
  if (!CATEGORIES.includes(category)) add("category", `Category must be one of ${CATEGORIES.join(", ")} (got "${categoryRaw}").`);

  const picName = get("pic_name") || "SELF";

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

  if (issues.length > 0) {
    return { line, externalId, summary, ok: false, issues };
  }

  // Cross-midnight: an on-block that is not after the off-block rolls to the
  // next calendar day, matching how a pilot reads an overnight flight.
  const arrDate = onN! <= offN! ? nextDay(date) : date;

  const entry: MappedEntry = {
    aircraft: {
      makeModelVariant: type,
      registration,
      engineClass: engineRaw as "SE" | "ME",
      multiPilot: multiPilot!,
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

  return { line, externalId, summary, ok: true, entry };
}

export interface ParsedCsv {
  /** Column headers as found (normalized names are matched case-insensitively). */
  headers: string[];
  rows: MappedRow[];
  /** File-level problems that stop the import before any row is considered. */
  fatal: string | null;
}

/**
 * Parse a whole CSV file and map every data row. File-level problems (no
 * header, a missing required column, no data rows) come back as `fatal`.
 */
export function parseImportCsv(text: string): ParsedCsv {
  const matrix = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (matrix.length === 0) {
    return { headers: [], rows: [], fatal: "The file is empty." };
  }
  const headers = matrix[0]!;
  const present = new Set(headers.map(normalizeHeader));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    return { headers, rows: [], fatal: `The file is missing required column(s): ${missing.join(", ")}. Start from the template.` };
  }
  if (matrix.length === 1) {
    return { headers, rows: [], fatal: "The file has a header row but no flights." };
  }
  const rows = matrix.slice(1).map((cells, i) => mapCsvRow(headers, cells, i + 2));
  return { headers, rows, fatal: null };
}
