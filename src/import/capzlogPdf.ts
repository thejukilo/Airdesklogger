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
 * A capzlog export can be a single report or a *combined* report with several
 * sections, each a different aircraft category ("Airplane Flights Report",
 * "Helicopter Flights Report", ...), each followed by a "References for ..."
 * signatures page, and each with its own column layout. v1 reads only the
 * Airplane section: pages are classified by their title and only Airplane data
 * pages are parsed; other categories are detected and reported, not imported.
 *
 * Within an Airplane page the grid is fixed-layout, so each word is assigned to
 * a column by its x-coordinate (robust to the wrapping "Info and Ref" column
 * and to empty cells). Pure and DB-free: unit tested against a real export.
 *
 * Coordinates are pdf.js-native (x,y in PDF points, y increasing upward), with
 * an explicit 1-based `page`.
 */

/** One positioned word, as produced by pdf.js getTextContent. */
export interface CapzlogTextItem {
  str: string;
  x: number;
  y: number;
  w?: number;
  /** 1-based page number; defaults to 1 when absent (single-page input). */
  page?: number;
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

function detectHolder(items: CapzlogTextItem[]): string | null {
  const email = items.find((i) => i.str.includes("@"));
  if (!email) return null;
  const name = items
    .filter((i) => (i.page ?? 1) === (email.page ?? 1) && Math.abs(i.y - email.y) < 4 && i.x < email.x)
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str)
    .join(" ")
    .trim();
  return name || null;
}

/** The top line of a page (pdf.js y increases upward, so the title has the
 * largest y), used to tell which report section a page belongs to. */
function pageTitle(pageItems: CapzlogTextItem[]): string {
  if (pageItems.length === 0) return "";
  const maxY = Math.max(...pageItems.map((i) => i.y));
  return pageItems
    .filter((i) => maxY - i.y < 5)
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str)
    .join(" ")
    .trim()
    .toLowerCase();
}

/** Extract one row per flight date-line from a single Airplane data page. */
function extractPageFlights(pageItems: CapzlogTextItem[], out: CapzlogPdfRow[]): void {
  const dateItems = pageItems.filter(
    (i) => i.x >= COLS.date[0] && i.x < COLS.date[1] && DATE_RE.test(i.str.trim()),
  );
  for (const d of dateItems) {
    const buckets: Partial<Record<Col, CapzlogTextItem[]>> = {};
    for (const it of pageItems) {
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
    out.push({
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
    });
  }
}

export function extractCapzlogPdf(items: CapzlogTextItem[]): CapzlogPdfExtract {
  const warnings: string[] = [];
  const holder = detectHolder(items);

  // Group items by page, in page order.
  const byPage = new Map<number, CapzlogTextItem[]>();
  for (const it of items) {
    const p = it.page ?? 1;
    const arr = byPage.get(p);
    if (arr) arr.push(it);
    else byPage.set(p, [it]);
  }
  const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]);

  const rows: CapzlogPdfRow[] = [];
  const otherCategories = new Set<string>();
  let sawAirplane = false;
  // A continuation page without its own title inherits the current section.
  let section: "airplane" | "other" | "references" | "unknown" | null = null;

  for (const [, pageItems] of pages) {
    const title = pageTitle(pageItems);
    if (title) {
      if (title.startsWith("references for") || title.includes("references for")) {
        section = "references";
      } else if (title.includes("airplane flights report")) {
        // The airplane *flights* data page — not "Airplane FSTD Sessions Report".
        section = "airplane";
        sawAirplane = true;
      } else if (title.includes("helicopter")) {
        section = "other";
        otherCategories.add("helicopter");
      } else if (title.includes("sailplane") || title.includes("glider")) {
        section = "other";
        otherCategories.add("glider/sailplane");
      } else if (title.includes("balloon")) {
        section = "other";
        otherCategories.add("balloon");
      } else if (title.includes("simulator") || title.includes("session")) {
        section = "other";
        otherCategories.add("simulator");
      } else {
        section = "unknown";
      }
    }
    if (section === "airplane") extractPageFlights(pageItems, rows);
  }

  const report: CapzlogPdfReport = sawAirplane ? "airplane" : "unknown";

  if (!sawAirplane) {
    const others = [...otherCategories];
    warnings.push(
      others.length > 0
        ? `This export has ${others.join(", ")} flights but no Airplane Flights Report — only Airplane flights can be imported for now.`
        : "This does not look like a capzlog Airplane Flights Report. Please upload one (or a combined export that includes it).",
    );
  } else if (rows.length === 0) {
    warnings.push("No flight rows were found in the Airplane section of this PDF.");
  }
  if (otherCategories.size > 0 && sawAirplane) {
    warnings.push(
      `This export also contains ${[...otherCategories].join(", ")} flights — only the Airplane flights were read; other categories aren’t supported yet.`,
    );
  }

  return { report, holder, rows, warnings };
}
