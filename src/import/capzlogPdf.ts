/**
 * capzlog.aero PDF report extraction.
 *
 * capzlog lets users export a PDF report without a paid subscription (the CSV
 * export is paid-only), so importing from the PDF lets a pilot migrate their
 * whole logbook for free. The browser reads the PDF with pdf.js and sends the
 * raw positioned text items here; this module turns that flat list of words
 * into one row per flight, which `mapCapzlogPdfRows` (src/http/capzlog.ts) then
 * maps through the exact same validation/creation pipeline as the CSV import.
 *
 * The report is a fixed-layout grid, so we assign each word to a column by its
 * x-coordinate (robust to the wrapping "Info and Ref" column and to empty
 * cells, which plain text extraction mangles). Pure and DB-free: unit tested
 * against a real exported report (test/fixtures/capzlog-airplane-items.json).
 *
 * v1 supports the Airplane report. Other categories (helicopter, sailplane,
 * balloon, simulator) have different column layouts and are detected but not
 * yet extracted.
 */

/** One positioned word, as produced by pdf.js getTextContent (x,y in PDF points). */
export interface CapzlogTextItem {
  str: string;
  x: number;
  y: number;
  w?: number;
}

export type CapzlogPdfReport =
  | "airplane"
  | "helicopter"
  | "sailplane"
  | "balloon"
  | "simulator"
  | "unknown";

/** Raw per-column cell strings for one flight, as printed. Interpretation
 * (dates, durations, which function column is set) happens in the mapper. */
export interface CapzlogPdfRow {
  date: string;
  depPlace: string;
  depTime: string;
  arrPlace: string;
  arrTime: string;
  reg: string;
  type: string;
  total: string;
  se: string;
  me: string;
  multiPilot: string;
  picName: string;
  dayLandings: string;
  nightLandings: string;
  night: string;
  ifr: string;
  fnPIC: string;
  fnCopi: string;
  fnDual: string;
  fnInstr: string;
}

export interface CapzlogPdfExtract {
  report: CapzlogPdfReport;
  /** Logbook holder's name from the report header, for the SELF-name rewrite. */
  holder: string | null;
  rows: CapzlogPdfRow[];
  warnings: string[];
}

/**
 * Column x-ranges [minX, maxX) for the Airplane report (A4 landscape template).
 * Derived from the report header; the Info/Ref column (x >= 732) is excluded so
 * its wrapping text never bleeds into the Instructor column.
 */
const COLS = {
  date: [10, 45],
  depPlace: [45, 70],
  depTime: [70, 100],
  arrPlace: [100, 123],
  arrTime: [123, 150],
  reg: [150, 185],
  type: [185, 220],
  total: [220, 255],
  se: [255, 285],
  me: [285, 315],
  multiPilot: [315, 350],
  picName: [350, 405],
  landDay: [405, 433],
  landNight: [433, 460],
  opDay: [460, 492],
  opNight: [492, 527],
  opVFR: [527, 560],
  opIFR: [560, 592],
  fnPIC: [592, 625],
  fnCopi: [625, 658],
  fnDual: [658, 692],
  fnInstr: [692, 732],
} as const;
type Col = keyof typeof COLS;
const CORE_MAX_X = 732; // anything to the right is the free-text Info/Ref column

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const stripZ = (s: string): string => s.replace(/z$/i, "").trim();

function colFor(x: number): Col | null {
  for (const k of Object.keys(COLS) as Col[]) {
    if (x >= COLS[k][0] && x < COLS[k][1]) return k;
  }
  return null;
}

function detectReport(items: CapzlogTextItem[]): CapzlogPdfReport {
  // The category appears only in the report title ("<Category> Flights Report"),
  // which an extractor may keep as one item (pdf.js) or split into words
  // (pdftotext) — so match the whole word anywhere, with no assumptions about
  // item order or y-direction.
  const text = " " + items.map((i) => i.str.toLowerCase()).join(" ") + " ";
  if (/\b(airplane|aeroplane)\b/.test(text)) return "airplane";
  if (/\bhelicopter\b/.test(text)) return "helicopter";
  if (/\b(sailplane|glider)\b/.test(text)) return "sailplane";
  if (/\bballoon\b/.test(text)) return "balloon";
  if (/\b(simulator|fstd)\b/.test(text)) return "simulator";
  return "unknown";
}

function detectHolder(items: CapzlogTextItem[]): string | null {
  // The holder line reads "First Last (email)". Find the word carrying the
  // email and join the words to its left on the same line.
  const email = items.find((i) => i.str.includes("@"));
  if (!email) return null;
  const name = items
    .filter((i) => Math.abs(i.y - email.y) < 4 && i.x < email.x)
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str)
    .join(" ")
    .trim();
  return name || null;
}

export function extractCapzlogPdf(items: CapzlogTextItem[]): CapzlogPdfExtract {
  const warnings: string[] = [];
  const report = detectReport(items);
  const holder = detectHolder(items);

  if (report !== "airplane") {
    warnings.push(
      report === "unknown"
        ? "This does not look like a capzlog report. Please upload a capzlog Airplane Flights Report PDF."
        : `The ${report} report is not supported yet — only the capzlog Airplane Flights Report can be imported.`,
    );
    return { report, holder, rows: [], warnings };
  }

  // Each flight is one "date line": a line whose Date column holds a M/D/YYYY.
  const dateItems = items.filter(
    (i) => i.x >= COLS.date[0] && i.x < COLS.date[1] && DATE_RE.test(i.str.trim()),
  );

  const rows: CapzlogPdfRow[] = dateItems.map((d) => {
    const buckets: Partial<Record<Col, CapzlogTextItem[]>> = {};
    for (const it of items) {
      if (Math.abs(it.y - d.y) >= 4 || it.x >= CORE_MAX_X) continue;
      const k = colFor(it.x);
      if (!k) continue;
      (buckets[k] ??= []).push(it);
    }
    const val = (k: Col): string =>
      (buckets[k] ?? [])
        .sort((a, b) => a.x - b.x)
        .map((w) => w.str)
        .join(" ")
        .trim();
    return {
      date: val("date"),
      depPlace: val("depPlace"),
      depTime: stripZ(val("depTime")),
      arrPlace: val("arrPlace"),
      arrTime: stripZ(val("arrTime")),
      reg: val("reg"),
      type: val("type"),
      total: val("total"),
      se: val("se"),
      me: val("me"),
      multiPilot: val("multiPilot"),
      picName: val("picName"),
      dayLandings: val("landDay"),
      nightLandings: val("landNight"),
      night: val("opNight"),
      ifr: val("opIFR"),
      fnPIC: val("fnPIC"),
      fnCopi: val("fnCopi"),
      fnDual: val("fnDual"),
      fnInstr: val("fnInstr"),
    };
  });

  if (rows.length === 0) {
    warnings.push("No flight rows were found. Make sure this is a capzlog Airplane Flights Report PDF.");
  }

  return { report, holder, rows, warnings };
}
