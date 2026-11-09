/**
 * capzlog.aero PDF report extraction.
 *
 * capzlog lets users export a PDF report without a paid subscription (the CSV
 * export is paid-only), so importing from the PDF lets a pilot migrate their
 * whole logbook for free. The browser reads the PDF with pdf.js and sends the
 * raw positioned text items here; this module turns that flat list of words
 * into one tagged row per flight, which `mapCapzlogPdfRows` (src/http/capzlog
 * .ts) maps through the exact same validation/creation pipeline as the CSV
 * import, per aircraft category.
 *
 * A capzlog export can be a single report or a *combined* report with several
 * sections, each a different aircraft category ("Airplane Flights Report",
 * "Helicopter Flights Report", ...), each followed by a "References for ..."
 * signatures page, and each with its own column layout. Pages are classified by
 * their title; each flight category has its own fixed column model, and each
 * word is assigned to a column by its x-coordinate. The "Airplane FSTD Sessions"
 * (simulator) section is a different kind of record and is not yet imported.
 *
 * Pure and DB-free: unit tested against real single-category and combined
 * exports. Coordinates are pdf.js-native (x,y in PDF points, y upward), with an
 * explicit 1-based `page`.
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

/** Flight categories this importer reads. */
export type CapzlogCategory = "airplane" | "helicopter" | "sailplane" | "balloon";

/** One extracted flight: its category and the raw cell strings by column name.
 * Interpretation (dates, durations, which function column is set) is done by
 * the mapper. */
export interface CapzlogPdfRow {
  category: CapzlogCategory;
  cells: Record<string, string>;
}

export interface CapzlogPdfExtract {
  /** A representative category for display; "unknown" when nothing was read. */
  report: CapzlogCategory | "unknown";
  /** Logbook holder's name from the report header, for the SELF-name rewrite. */
  holder: string | null;
  rows: CapzlogPdfRow[];
  warnings: string[];
}

/**
 * Column x-ranges [minX, maxX) per category (A4 landscape templates). Only the
 * columns the mapper needs are listed; anything outside every range (the free-
 * text Info/Ref column, the derived Day/VFR columns) is ignored. Values:
 *  - acType: the ICAO designator (A210, GLID, BALL-H, G2CA)
 *  - acModel: the human model text, when the report prints it separately
 *    (sailplane "ASG 32"); absent otherwise.
 */
const MODELS: Record<CapzlogCategory, Record<string, readonly [number, number]>> = {
  airplane: {
    date: [10, 45], depPlace: [45, 70], depTime: [70, 100], arrPlace: [100, 123], arrTime: [123, 150],
    reg: [150, 185], acType: [185, 220], total: [220, 255], se: [255, 285], me: [285, 315],
    multiPilot: [315, 350], picName: [350, 405], landDay: [405, 433], landNight: [433, 460],
    night: [492, 527], ifr: [560, 592],
    fnPIC: [592, 625], fnCopi: [625, 658], fnDual: [658, 692], fnInstr: [692, 732],
  },
  // The helicopter grid is identical to the airplane grid.
  helicopter: {
    date: [10, 45], depPlace: [45, 70], depTime: [70, 100], arrPlace: [100, 123], arrTime: [123, 150],
    reg: [150, 185], acType: [185, 220], total: [220, 255], se: [255, 285], me: [285, 315],
    multiPilot: [315, 350], picName: [350, 405], landDay: [405, 433], landNight: [433, 460],
    night: [492, 527], ifr: [560, 592],
    fnPIC: [592, 625], fnCopi: [625, 658], fnDual: [658, 692], fnInstr: [692, 732],
  },
  sailplane: {
    date: [10, 45], depPlace: [45, 75], depTime: [75, 105], arrPlace: [105, 128], arrTime: [128, 165],
    reg: [165, 210], acModel: [210, 268], acType: [268, 310], total: [310, 368], picName: [368, 445],
    launch: [445, 490], landDay: [490, 525],
    fnPIC: [620, 662], fnDual: [662, 695], fnInstr: [695, 735],
  },
  balloon: {
    date: [10, 45], depPlace: [45, 90], depTime: [90, 128], arrPlace: [128, 168], arrTime: [168, 200],
    reg: [200, 235], acType: [235, 270], total: [270, 310], picName: [450, 520], landDay: [520, 548],
    fnPIC: [635, 668], fnDual: [668, 698], fnInstr: [698, 735],
  },
};

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const stripZ = (s: string): string => s.replace(/z$/i, "").trim();

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

/** The top line of a page (pdf.js y increases upward), used to tell which
 * report section a page belongs to. */
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

/** Extract one row per flight date-line from a single category data page. */
function extractPageRows(pageItems: CapzlogTextItem[], category: CapzlogCategory, out: CapzlogPdfRow[]): void {
  const model = MODELS[category];
  // The date is in the leftmost column for every category.
  const dateItems = pageItems.filter(
    (i) => i.x >= 10 && i.x < 45 && DATE_RE.test(i.str.trim()),
  );
  for (const d of dateItems) {
    const line = pageItems.filter((i) => Math.abs(i.y - d.y) < 4);
    const cells: Record<string, string> = {};
    for (const field of Object.keys(model)) {
      const [min, max] = model[field]!;
      const ws = line.filter((i) => i.x >= min && i.x < max).sort((a, b) => a.x - b.x);
      if (ws.length) cells[field] = ws.map((w) => w.str).join(" ").trim();
    }
    if (cells.depTime) cells.depTime = stripZ(cells.depTime);
    if (cells.arrTime) cells.arrTime = stripZ(cells.arrTime);
    out.push({ category, cells });
  }
}

/** Classify a page title into a report section. */
function sectionOf(title: string): CapzlogCategory | "references" | "simulator" | "unknown" {
  if (title.includes("references for") || title.startsWith("markers")) return "references";
  if (title.includes("airplane flights report")) return "airplane";
  if (title.includes("helicopter flights report")) return "helicopter";
  if (title.includes("sailplane flights report") || title.includes("glider flights report")) return "sailplane";
  if (title.includes("balloon flights report")) return "balloon";
  if (title.includes("fstd") || title.includes("simulator") || title.includes("sessions")) return "simulator";
  return "unknown";
}

export function extractCapzlogPdf(items: CapzlogTextItem[]): CapzlogPdfExtract {
  const warnings: string[] = [];
  const holder = detectHolder(items);

  const byPage = new Map<number, CapzlogTextItem[]>();
  for (const it of items) {
    const p = it.page ?? 1;
    const arr = byPage.get(p);
    if (arr) arr.push(it);
    else byPage.set(p, [it]);
  }
  const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]);

  const rows: CapzlogPdfRow[] = [];
  const seen = new Set<CapzlogCategory>();
  let sawSimulator = false;
  // A continuation page without its own title inherits the current section.
  let section: ReturnType<typeof sectionOf> | null = null;

  for (const [, pageItems] of pages) {
    const title = pageTitle(pageItems);
    if (title) section = sectionOf(title);
    if (section === "simulator") sawSimulator = true;
    if (section === "airplane" || section === "helicopter" || section === "sailplane" || section === "balloon") {
      seen.add(section);
      extractPageRows(pageItems, section, rows);
    }
  }

  const report: CapzlogPdfExtract["report"] = rows[0]?.category ?? "unknown";

  if (rows.length === 0) {
    warnings.push(
      sawSimulator
        ? "This export only has simulator (FSTD) sessions, which aren’t supported yet. Export a flights report (Airplane, Helicopter, Sailplane or Balloon)."
        : "This does not look like a capzlog flights report. Please upload one (Airplane, Helicopter, Sailplane or Balloon — or a combined export).",
    );
  } else if (sawSimulator) {
    warnings.push(
      "This export also contains simulator (FSTD) sessions — those aren’t supported yet; only the flights were read.",
    );
  }

  return { report, holder, rows, warnings };
}
