/**
 * PDF logbook generator.
 *
 * Renders the pilot's data onto the traditional EASA paper logbook layout: a
 * landscape grid whose columns are exactly the 12 mandatory columns of AMC1
 * FCL.050 (with their sub-columns). Each page carries:
 *   - the entry rows for that page;
 *   - the three EASA total rows (this page / brought forward / total time), with
 *     the running grand total threaded across pages;
 *   - a signature block for the pilot to certify the page.
 *
 * Built on pdf-lib (pure JS, standard fonts) so it runs unchanged in Vercel
 * serverless functions, with no runtime font-file reads or native binaries.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  PDFName,
  PDFArray,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { formatHHMM } from "../domain/duration.js";
import { formatLogbookDate } from "../domain/time.js";
import { paginate, type ColumnTotals, type LogbookPage } from "../domain/totals.js";
import type { DerivedColumns } from "../domain/types.js";
import type { SummableField } from "../domain/columns.js";

interface LeafColumn {
  group: string; // top header (column group title)
  sub: string; // sub-header
  width: number;
  value: (e: DerivedColumns) => string;
  totalKey?: SummableField; // present => summed directly in the totals rows
  totalValue?: (t: ColumnTotals) => string; // present => totals derived from the summed columns
}

const MIN = (m: number) => (m > 0 ? formatHHMM(m) : "");
const NUM = (n: number) => (n > 0 ? String(n) : "");
// HH:MM with Z for UTC, or L when the time is stored as local (could not be converted).
const TIME = (d: Date, e: DerivedColumns) => d.toISOString().slice(11, 16) + (e.timesLocal ? "L" : "Z");

const DEFAULT_COLUMNS: LeafColumn[] = [
  { group: "DATE", sub: "dd/mm/yy", width: 58, value: (e) => formatLogbookDate(e.departureTime) },
  { group: "DEPARTURE", sub: "Place", width: 44, value: (e) => e.departurePlace },
  { group: "DEPARTURE", sub: "Time", width: 38, value: (e) => TIME(e.departureTime, e) },
  { group: "ARRIVAL", sub: "Place", width: 44, value: (e) => e.arrivalPlace },
  { group: "ARRIVAL", sub: "Time", width: 38, value: (e) => TIME(e.arrivalTime, e) },
  { group: "AIRCRAFT", sub: "Type", width: 72, value: (e) => "" }, // filled from content below
  { group: "AIRCRAFT", sub: "Reg", width: 56, value: () => "" },
  { group: "SINGLE-PILOT", sub: "SE", width: 40, value: (e) => MIN(e.singleEngine), totalKey: "singleEngine" },
  { group: "SINGLE-PILOT", sub: "ME", width: 40, value: (e) => MIN(e.multiEngine), totalKey: "multiEngine" },
  { group: "MULTI-PILOT", sub: "time", width: 54, value: (e) => MIN(e.multiPilot), totalKey: "multiPilot" },
  { group: "TOTAL", sub: "time", width: 50, value: (e) => MIN(e.total), totalKey: "total" },
  { group: "NAME PIC", sub: "", width: 78, value: () => "" },
  { group: "LANDINGS", sub: "Day", width: 30, value: (e) => NUM(e.dayLandings), totalKey: "dayLandings" },
  { group: "LANDINGS", sub: "Ngt", width: 30, value: (e) => NUM(e.nightLandings), totalKey: "nightLandings" },
  { group: "COND. TIME", sub: "Day", width: 38, value: (e) => MIN(e.total - e.night), totalValue: (t) => MIN(t.total - t.night) },
  { group: "COND. TIME", sub: "Night", width: 38, value: (e) => MIN(e.night), totalKey: "night" },
  { group: "COND. TIME", sub: "VFR", width: 38, value: (e) => MIN(e.total - e.ifr), totalValue: (t) => MIN(t.total - t.ifr) },
  { group: "COND. TIME", sub: "IFR", width: 38, value: (e) => MIN(e.ifr), totalKey: "ifr" },
  { group: "FUNCTION TIME", sub: "PIC", width: 40, value: (e) => MIN(e.pic), totalKey: "pic" },
  { group: "FUNCTION TIME", sub: "Co", width: 40, value: (e) => MIN(e.coPilot), totalKey: "coPilot" },
  { group: "FUNCTION TIME", sub: "Dual", width: 40, value: (e) => MIN(e.dual), totalKey: "dual" },
  { group: "FUNCTION TIME", sub: "Instr", width: 40, value: (e) => MIN(e.instructor), totalKey: "instructor" },
  { group: "REMARKS", sub: "& endorsements", width: 150, value: () => "" },
];

// Balloons have no engine class and no multi-pilot operation; instead the
// flight time is split into the four hot-air envelope groups (BFCL.050) plus an
// optional gas column for gas balloons. IFR doesn't apply.
const BALLOON_COLUMNS: LeafColumn[] = [
  { group: "DATE", sub: "dd/mm/yy", width: 58, value: (e) => formatLogbookDate(e.departureTime) },
  { group: "DEPARTURE", sub: "Place", width: 44, value: (e) => e.departurePlace },
  { group: "DEPARTURE", sub: "Time", width: 38, value: (e) => TIME(e.departureTime, e) },
  { group: "ARRIVAL", sub: "Place", width: 44, value: (e) => e.arrivalPlace },
  { group: "ARRIVAL", sub: "Time", width: 38, value: (e) => TIME(e.arrivalTime, e) },
  { group: "BALLOON", sub: "Reg", width: 64, value: () => "" }, // filled below from content
  { group: "TOTAL", sub: "time", width: 48, value: (e) => MIN(e.total), totalKey: "total" },
  { group: "HOT-AIR GROUP", sub: "A", width: 38, value: (e) => MIN(e.balloonGroupA ?? 0), totalKey: "balloonGroupA" },
  { group: "HOT-AIR GROUP", sub: "B", width: 38, value: (e) => MIN(e.balloonGroupB ?? 0), totalKey: "balloonGroupB" },
  { group: "HOT-AIR GROUP", sub: "C", width: 38, value: (e) => MIN(e.balloonGroupC ?? 0), totalKey: "balloonGroupC" },
  { group: "HOT-AIR GROUP", sub: "D", width: 38, value: (e) => MIN(e.balloonGroupD ?? 0), totalKey: "balloonGroupD" },
  { group: "GAS", sub: "time", width: 40, value: (e) => MIN(e.balloonGas ?? 0), totalKey: "balloonGas" },
  { group: "NAME PIC", sub: "", width: 78, value: () => "" },
  { group: "LANDINGS", sub: "Day", width: 30, value: (e) => NUM(e.dayLandings), totalKey: "dayLandings" },
  { group: "LANDINGS", sub: "Ngt", width: 30, value: (e) => NUM(e.nightLandings), totalKey: "nightLandings" },
  { group: "OP. TIME", sub: "Day", width: 38, value: (e) => MIN(e.total - e.night), totalValue: (t) => MIN(t.total - t.night) },
  { group: "OP. TIME", sub: "Night", width: 38, value: (e) => MIN(e.night), totalKey: "night" },
  { group: "FUNCTION TIME", sub: "PIC", width: 40, value: (e) => MIN(e.pic), totalKey: "pic" },
  { group: "FUNCTION TIME", sub: "Dual", width: 40, value: (e) => MIN(e.dual), totalKey: "dual" },
  { group: "FUNCTION TIME", sub: "Instr", width: 40, value: (e) => MIN(e.instructor), totalKey: "instructor" },
  { group: "REMARKS", sub: "& endorsements", width: 132, value: () => "" },
];

function columnsForCategory(label: string): LeafColumn[] {
  return label === "Balloon" ? BALLOON_COLUMNS : DEFAULT_COLUMNS;
}

/** Default array kept for code paths that don't yet know the category. */
const COLUMNS = DEFAULT_COLUMNS;

function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${(y ?? "").slice(2)}`;
}

/** Remarks cell: free text, then any structured attributes, then a sign-off flag. */
function remarksText(e: LogbookEntryForPdf): string {
  const parts: string[] = [];
  if (e.remarks) parts.push(e.remarks);
  if (e.departurePlaceName) parts.push(`(from: ${e.departurePlaceName})`);
  if (e.arrivalPlaceName) parts.push(`(to: ${e.arrivalPlaceName})`);
  if (e.operatingRole) parts.push(e.operatingRole === "PILOT_FLYING" ? "(PF)" : "(PM)");
  if (e.crewSize > 2) parts.push(`(augmented crew of ${e.crewSize})`);
  if (e.launchMethod) parts.push(`(launch: ${e.launchMethod})`);
  if (e.balloonFlightType) parts.push(e.balloonFlightType === "TETHERED" ? "(tethered)" : "(free flight)");
  if (e.inflations) parts.push(`(${e.inflations} inflation${e.inflations === 1 ? "" : "s"})`);
  if (e.instructorPosition && e.instructorPosition !== "PILOT_SEAT") parts.push(`(${e.instructorPosition})`);
  if (e.attributes.length) parts.push(`[${e.attributes.join(", ")}]`);
  const d = e.attributeDetails;
  if (d) {
    if (d.hesloLevel) parts.push(`(HESLO ${d.hesloLevel})`);
    if (d.hecLevel) parts.push(`(HEC ${d.hecLevel})`);
    if (d.hoistCycles) parts.push(`(${d.hoistCycles} cycles)`);
    if (d.mountainLandingGear) parts.push(`(mountain: ${d.mountainLandingGear.toLowerCase()})`);
    if (d.lowVisibilityLandingType) parts.push(`(low-vis: ${d.lowVisibilityLandingType})`);
  }
  // The signed / SIGNATURE MISSING flag is drawn separately as a clickable link
  // in the remarks cell so it can jump to the sign-offs appendix.
  return parts.join(" ");
}

const MARGIN = 28;
const HEADER_H = 30; // two-row column header
const ROW_H = 18;
const TOTAL_ROW_H = 16;
const SIG_H = 70;
const GRID_W = COLUMNS.reduce((a, c) => a + c.width, 0);

/**
 * Standard paper sizes, in PDF points, given in portrait. The logbook grid is
 * drawn in landscape, so the dimensions are swapped for the grid pages and used
 * as-is for the portrait appendix pages.
 */
export type PaperSize = "A4" | "LETTER";
const PAGE_PORTRAIT: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  LETTER: { w: 612, h: 792 },
};
const landscape = (d: { w: number; h: number }) => ({ w: d.h, h: d.w });

/** Natural width of the whole grid block including its outer margins. */
const CONTENT_W = GRID_W + 2 * MARGIN;
/** Natural height of everything on a grid page apart from the entry rows. */
const PAGE_FIXED_H = HEADER_H + 3 * TOTAL_ROW_H + SIG_H + 3 * MARGIN + 24;

/**
 * The grid is scaled to fit the chosen page width, which fixes the scale (and so
 * the text size) regardless of how many rows are on the page. We then choose how
 * many rows to lay out so that the scaled grid fills the page height rather than
 * floating in a sea of white. Every page uses the same count, so the scale is
 * identical from page to page.
 */
function rowsToFillPage(paper: PaperSize): number {
  const land = landscape(PAGE_PORTRAIT[paper]);
  const scale = land.w / CONTENT_W;
  const naturalH = land.h / scale;
  return Math.max(1, Math.floor((naturalH - PAGE_FIXED_H) / ROW_H));
}

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.45, 0.45, 0.45);
const SHADE = rgb(0.93, 0.93, 0.93);

export interface LogbookEntryForPdf extends DerivedColumns {
  /** The entry's stable id, so a row can link to its block in the sign-offs appendix. */
  entryId?: string;
  aircraftType: string;
  aircraftReg: string;
  picName: string;
  remarks: string;
  /** Whether a valid sign-off exists on the current version. */
  signed?: boolean;
  /** True when the entry needs a signature (required, or invalidated by an edit) but has none. */
  signatureMissing?: boolean;
}

export interface PdfOptions {
  pilotName: string;
  licenseNumber?: string;
  holderAddress?: string;
  dateOfBirth?: string;
  rowsPerPage?: number;
  /** Page size for the export. Defaults to A4. */
  paperSize?: PaperSize;
}

/** Appendix content for a FOCA-style export (sign-offs and the change log). */
export interface AppendixSignature {
  signerName: string;
  signerRole: string;
  signerLicense: string | null;
  signedPlace: string | null;
  signedAt: string;
  /** PNG data URL of the drawn signature, when present. */
  signatureImage: string | null;
  valid: boolean;
}

export interface AppendixSignoff {
  entryId: string;
  /** Human reference shown in the heading, e.g. "2026-05-28 #4". */
  entryRef: string;
  signatures: AppendixSignature[];
}

export interface AuditAppendix {
  signoffs: AppendixSignoff[];
  changeLog: Array<{ entry: string; text: string }>;
}

/** Aircraft categories print on their own pages, since the columns differ. */
const CATEGORY_ORDER = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  AEROPLANE: "Aeroplane",
  HELICOPTER: "Helicopter",
  SAILPLANE: "Sailplane",
  BALLOON: "Balloon",
};

function groupByCategory(
  entries: readonly LogbookEntryForPdf[],
): Array<{ label: string; entries: LogbookEntryForPdf[] }> {
  const byCat = new Map<string, LogbookEntryForPdf[]>();
  for (const e of entries) {
    const cat = e.category && CATEGORY_LABEL[e.category] ? e.category : "AEROPLANE";
    const list = byCat.get(cat) ?? [];
    list.push(e);
    byCat.set(cat, list);
  }
  const groups: Array<{ label: string; entries: LogbookEntryForPdf[] }> = [];
  for (const cat of CATEGORY_ORDER) {
    if (byCat.has(cat)) groups.push({ label: CATEGORY_LABEL[cat]!, entries: byCat.get(cat)! });
  }
  for (const [cat, list] of byCat) {
    if (!CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number])) groups.push({ label: cat, entries: list });
  }
  return groups;
}

export async function generateLogbookPdf(
  entries: readonly LogbookEntryForPdf[],
  opts: PdfOptions,
  audit?: AuditAppendix,
): Promise<Uint8Array> {
  const paper = opts.paperSize ?? "A4";
  const rowsPerPage = opts.rowsPerPage ?? rowsToFillPage(paper);
  const resolved: PdfOptions = { ...opts, paperSize: paper, rowsPerPage };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Flights print in the category grids; synthetic training sessions are kept
  // out of those tables and listed separately afterwards.
  const flights = entries.filter((e) => e.kind !== "FSTD");
  const fstdSessions = entries.filter((e) => e.kind === "FSTD");

  // Each aircraft category prints as its own run of pages, with its own
  // page-by-page totals, since their columns and rules differ. The link
  // context collects per-row "signed" rects and per-entry appendix targets, so
  // we can wire one-click jumps from the row to the appendix block at the end.
  const linkCtx: SignedLinkContext = { rowRects: new Map(), appendixTargets: new Map() };
  const groups = groupByCategory(flights);
  if (groups.length === 0 && fstdSessions.length === 0) {
    drawPage(doc, font, bold, emptyPage(), 1, resolved, [], "", linkCtx);
  } else {
    for (const group of groups) {
      const pages = paginate(group.entries, rowsPerPage).pages;
      const list = pages.length > 0 ? pages : [emptyPage()];
      for (const page of list) {
        drawPage(doc, font, bold, page, list.length, resolved, group.entries, group.label, linkCtx);
      }
    }
  }

  if (fstdSessions.length > 0) {
    drawFstdSection(doc, font, bold, fstdSessions, resolved.pilotName, PAGE_PORTRAIT[paper]);
  }

  if (audit) {
    const portrait = PAGE_PORTRAIT[paper];
    if (audit.signoffs.length > 0) {
      await drawSignoffsAppendix(doc, font, bold, audit.signoffs, opts.pilotName, portrait, linkCtx);
      // Now both ends of each "signed" hyperlink are placed; attach the
      // annotations so the row tag jumps to the appendix block.
      for (const [entryId, source] of linkCtx.rowRects) {
        const target = linkCtx.appendixTargets.get(entryId);
        if (target) addInternalLink(doc, source.page, source.rect, target.page, target.y);
      }
    }
    // The change log is a mandatory part of the export (FOCA 2.3.7).
    drawAppendix(doc, font, bold, "CHANGE LOG", audit.changeLog, opts.pilotName, portrait);
  }

  return doc.save();
}

/** A scaled-grid drawing context shares state for the row->appendix back-link. */
interface SignedLinkContext {
  /** A row's "signed" cell, in the page's PDF coordinate space. */
  rowRects: Map<string, { page: PDFPage; rect: [number, number, number, number] }>;
  /** Where in the appendix that entry's block starts. */
  appendixTargets: Map<string, { page: PDFPage; y: number }>;
}

const SIGNOFF_ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: "Instructor",
  EXAMINER: "Examiner",
  SUPERVISING_PIC: "Supervising PIC",
  ATO: "ATO",
  DTO: "DTO",
  HOT: "Head of training",
  AIRPORT: "Airport",
  OTHER: "Other",
};

/** Sign-offs appendix: one block per entry showing signer, place, date and image. */
async function drawSignoffsAppendix(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  signoffs: ReadonlyArray<AppendixSignoff>,
  pilotName: string,
  page: { w: number; h: number },
  ctx: SignedLinkContext,
): Promise<void> {
  const top = page.h - MARGIN;
  const bottom = MARGIN + 20;
  const drawHeader = (p: PDFPage) => {
    p.drawText("SIGN-OFFS", { x: MARGIN, y: top - 12, size: 12, font: bold, color: BLACK });
    p.drawText(`Holder: ${pilotName}    All times UTC`, { x: MARGIN, y: top - 26, size: 8, font, color: GREY });
  };

  let p = doc.addPage([page.w, page.h]);
  drawHeader(p);
  let y = top - 48;

  for (const so of signoffs) {
    // Block height: heading (16) + per-signature (40) + spacing.
    const blockH = 16 + so.signatures.length * 40 + 6;
    if (y - blockH < bottom) {
      p = doc.addPage([page.w, page.h]);
      drawHeader(p);
      y = top - 48;
    }
    // Record the back-link target before drawing this entry's heading.
    ctx.appendixTargets.set(so.entryId, { page: p, y: y + 14 });

    p.drawText(so.entryRef, { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    hline(p, MARGIN, page.w - MARGIN, y - 3, GREY, 0.4);
    y -= 16;

    for (const s of so.signatures) {
      // Embed and draw the signature image on the right, if there is one.
      if (s.signatureImage && s.signatureImage.startsWith("data:image/")) {
        try {
          const b64 = s.signatureImage.split(",")[1] ?? "";
          const isPng = s.signatureImage.startsWith("data:image/png");
          const img = isPng ? await doc.embedPng(b64) : await doc.embedJpg(b64);
          const targetH = 30;
          const scale = targetH / img.height;
          const w = img.width * scale;
          p.drawImage(img, { x: page.w - MARGIN - w - 4, y: y - 28, width: w, height: targetH });
        } catch {
          // Bad/unsupported image data: skip silently rather than break the export.
        }
      }
      const role = SIGNOFF_ROLE_LABELS[s.signerRole] ?? s.signerRole;
      p.drawText(`${role}: ${s.signerName}`, { x: MARGIN + 8, y, size: 9, font: bold, color: BLACK });
      const meta: string[] = [];
      if (s.signerLicense) meta.push(`Licence ${s.signerLicense}`);
      if (s.signedPlace) meta.push(`at ${s.signedPlace}`);
      meta.push(`on ${s.signedAt.slice(0, 10)}`);
      if (!s.valid) meta.push("INVALID");
      p.drawText(meta.join("  -  "), { x: MARGIN + 8, y: y - 12, size: 7.5, font, color: GREY });
      y -= 40;
    }
    y -= 6;
  }
}

function drawAppendix(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  title: string,
  rows: ReadonlyArray<{ entry: string; text: string }>,
  pilotName: string,
  page: { w: number; h: number },
): void {
  const lineH = 13;
  const top = page.h - MARGIN;
  const bottom = MARGIN + 20;
  const usable = top - 40 - bottom;
  const perPage = Math.max(1, Math.floor(usable / lineH));
  const lines = rows.length > 0 ? rows : [{ entry: "", text: "None recorded." }];
  const pageCount = Math.ceil(lines.length / perPage);

  for (let pageNo = 0; pageNo < pageCount; pageNo++) {
    const p = doc.addPage([page.w, page.h]);
    p.drawText(title, { x: MARGIN, y: top - 12, size: 12, font: bold, color: BLACK });
    p.drawText(`Holder: ${pilotName}    All times UTC`, {
      x: MARGIN,
      y: top - 26,
      size: 8,
      font,
      color: GREY,
    });
    let y = top - 48;
    for (const row of lines.slice(pageNo * perPage, (pageNo + 1) * perPage)) {
      if (row.entry) p.drawText(clip(row.entry, 130, 8, bold), { x: MARGIN, y, size: 8, font: bold, color: BLACK });
      p.drawText(clip(row.text, page.w - MARGIN * 2 - 140, 8, font), {
        x: MARGIN + 140,
        y,
        size: 8,
        font,
        color: BLACK,
      });
      y -= lineH;
    }
  }
}

/**
 * Synthetic training (FSTD) sessions, on their own portrait table: date, device,
 * qualification, total time and remarks, with a total-time line. Kept apart from
 * the flight grids (AMC1 FCL.050 records simulator time separately from flight).
 */
function drawFstdSection(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  sessions: readonly LogbookEntryForPdf[],
  pilotName: string,
  page: { w: number; h: number },
): void {
  const lineH = 16;
  const left = MARGIN;
  const right = page.w - MARGIN;
  const top = page.h - MARGIN;
  const fnLabel = (v?: string) => (v === "SFI_SFE" ? "SFI/SFE" : v === "TRAINEE" ? "Trainee" : "");
  const fixed = [
    { title: "Date", w: 55, get: (e: LogbookEntryForPdf) => (e.fstd ? fmtIsoDate(e.fstd.date) : "") },
    { title: "Model", w: 85, get: (e: LogbookEntryForPdf) => e.fstd?.deviceType ?? "" },
    { title: "EASA code", w: 85, get: (e: LogbookEntryForPdf) => e.fstd?.qualificationNumber ?? "" },
    { title: "Type", w: 60, get: (e: LogbookEntryForPdf) => e.fstd?.qualification ?? "" },
    { title: "Function", w: 60, get: (e: LogbookEntryForPdf) => fnLabel(e.fstd?.pilotFunction) },
    { title: "Total", w: 42, get: (e: LogbookEntryForPdf) => (e.fstd ? MIN(e.fstd.totalMinutes) : "") },
    {
      title: "Ldg",
      w: 36,
      get: (e: LogbookEntryForPdf) => (e.dayLandings + e.nightLandings > 0 ? `${e.dayLandings}/${e.nightLandings}` : ""),
    },
  ];
  const fixedW = fixed.reduce((a, c) => a + c.w, 0);
  const remarksX = left + fixedW;
  const remarksW = right - remarksX;

  const usable = top - 48 - (MARGIN + 20);
  const perPage = Math.max(1, Math.floor(usable / lineH) - 1); // leave a line for the total
  const pageCount = Math.ceil(sessions.length / perPage);
  const grandTotal = sessions.reduce((a, e) => a + (e.fstd?.totalMinutes ?? 0), 0);

  for (let pageNo = 0; pageNo < pageCount; pageNo++) {
    const p = doc.addPage([page.w, page.h]);
    p.drawText("SYNTHETIC TRAINING DEVICES (FSTD)", { x: left, y: top - 12, size: 12, font: bold, color: BLACK });
    p.drawText(`Holder: ${pilotName}    All times UTC`, { x: left, y: top - 26, size: 8, font, color: GREY });

    let y = top - 46;
    // Header.
    let hx = left;
    for (const c of fixed) {
      p.drawText(c.title, { x: hx + 2, y, size: 7, font: bold, color: BLACK });
      hx += c.w;
    }
    p.drawText("Remarks & endorsements", { x: remarksX + 2, y, size: 7, font: bold, color: BLACK });
    y -= 4;
    hline(p, left, right, y);
    y -= lineH - 4;

    const slice = sessions.slice(pageNo * perPage, (pageNo + 1) * perPage);
    for (const e of slice) {
      let x = left;
      for (const c of fixed) {
        leftText(p, c.get(e), x, c.w, y, 8, font);
        x += c.w;
      }
      leftText(p, remarksText(e), remarksX, remarksW, y, 8, font);
      y -= lineH;
    }

    // Total time on the last page, under the Total column.
    if (pageNo === pageCount - 1) {
      const totalIdx = fixed.findIndex((c) => c.title === "Total");
      const totalX = left + fixed.slice(0, totalIdx).reduce((a, c) => a + c.w, 0);
      hline(p, left, right, y + lineH - 4);
      p.drawText("TOTAL FSTD TIME", { x: left + 2, y: y - 2, size: 8, font: bold, color: BLACK });
      p.drawText(formatHHMM(grandTotal), { x: totalX + 2, y: y - 2, size: 8, font: bold, color: BLACK });
    }
  }
}

function emptyPage(): LogbookPage {
  const zero = Object.fromEntries(COLUMNS.filter((c) => c.totalKey).map((c) => [c.totalKey!, 0])) as ColumnTotals;
  return { pageNumber: 1, rows: [], thisPage: zero, broughtForward: zero, carriedForward: zero };
}

function drawPage(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  page: LogbookPage,
  totalPages: number,
  opts: PdfOptions,
  allEntries: readonly LogbookEntryForPdf[],
  categoryLabel = "",
  linkCtx?: SignedLinkContext,
): void {
  const paper = opts.paperSize ?? "A4";
  const rowsPerPage = opts.rowsPerPage ?? rowsToFillPage(paper);
  const gridH = HEADER_H + rowsPerPage * ROW_H + 3 * TOTAL_ROW_H;
  // Balloon pages have a different column block, so the grid width differs.
  const cols = columnsForCategory(categoryLabel);
  const gridW = cols.reduce((a, c) => a + c.width, 0);
  const contentW = gridW + 2 * MARGIN;
  const contentH = gridH + SIG_H + 3 * MARGIN + 24;

  // The grid is drawn at its natural size, then scaled to fit a standard
  // landscape page (A4 or US Letter) and centred. Drawing everything inside one
  // graphics-state transform keeps every page at the same scale.
  const land = landscape(PAGE_PORTRAIT[paper]);
  const p = doc.addPage([land.w, land.h]);
  const scale = Math.min(land.w / contentW, land.h / contentH);
  const tx = (land.w - contentW * scale) / 2;
  const ty = (land.h - contentH * scale) / 2;
  p.pushOperators(pushGraphicsState(), concatTransformationMatrix(scale, 0, 0, scale, tx, ty));

  // Title / identity strip, in natural (pre-scale) coordinates.
  const top = contentH - MARGIN;
  p.drawText(`EASA FLIGHT CREW LOGBOOK  -  AMC1 FCL.050${categoryLabel ? `  -  ${categoryLabel}` : ""}`, { x: MARGIN, y: top - 10, size: 11, font: bold, color: BLACK });
  p.drawText(
    `Holder: ${opts.pilotName}${opts.dateOfBirth ? `    DOB: ${opts.dateOfBirth}` : ""}` +
      `${opts.licenseNumber ? `    Licence: ${opts.licenseNumber}` : ""}` +
      `${opts.holderAddress ? `    Address: ${opts.holderAddress}` : ""}    Times: Z = UTC (Zulu), L = local`,
    { x: MARGIN, y: top - 24, size: 8, font, color: GREY },
  );
  p.drawText(`Page ${page.pageNumber} of ${totalPages}`, {
    x: contentW - MARGIN - 70,
    y: top - 10,
    size: 9,
    font,
    color: BLACK,
  });

  const gridTop = top - 36;
  // Mapper from natural (pre-scale) coords to PDF page coords, for the link
  // annotations that wire a row's "signed" cell back to the appendix.
  const toPdfRect = (x: number, y: number, w: number, h: number): [number, number, number, number] => [
    x * scale + tx,
    y * scale + ty,
    (x + w) * scale + tx,
    (y + h) * scale + ty,
  ];
  drawGrid(p, font, bold, gridTop, page, rowsPerPage, allEntries, cols, gridW, linkCtx, toPdfRect);
  drawSignatureBlock(p, font, bold, gridTop - gridH - 14, contentW, opts.pilotName);

  p.pushOperators(popGraphicsState());
}

function colX(cols: LeafColumn[], index: number): number {
  let x = MARGIN;
  for (let i = 0; i < index; i++) x += cols[i]!.width;
  return x;
}

function centeredText(p: PDFPage, text: string, x: number, w: number, y: number, size: number, font: PDFFont, color = BLACK): void {
  if (!text) return;
  const clipped = clip(text, w - 4, size, font);
  const tw = font.widthOfTextAtSize(clipped, size);
  p.drawText(clipped, { x: x + (w - tw) / 2, y, size, font, color });
}

function leftText(p: PDFPage, text: string, x: number, w: number, y: number, size: number, font: PDFFont, color = BLACK): void {
  if (!text) return;
  p.drawText(clip(text, w - 4, size, font), { x: x + 2, y, size, font, color });
}

function clip(text: string, maxW: number, size: number, font: PDFFont): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxW) s = s.slice(0, -1);
  return s + "...";
}

function hline(p: PDFPage, x1: number, x2: number, y: number, color = BLACK, thickness = 0.5): void {
  p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}
function vline(p: PDFPage, x: number, y1: number, y2: number, color = BLACK, thickness = 0.5): void {
  p.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color, thickness });
}

function drawGrid(
  p: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  gridTop: number,
  page: LogbookPage,
  rowsPerPage: number,
  allEntries: readonly LogbookEntryForPdf[],
  cols: LeafColumn[],
  gridW: number,
  linkCtx?: SignedLinkContext,
  toPdfRect?: (x: number, y: number, w: number, h: number) => [number, number, number, number],
): void {
  const bodyTop = gridTop - HEADER_H;
  const bodyBottom = bodyTop - rowsPerPage * ROW_H;
  const totalsBottom = bodyBottom - 3 * TOTAL_ROW_H;

  // Header shading.
  p.drawRectangle({ x: MARGIN, y: bodyTop, width: gridW, height: HEADER_H, color: SHADE });

  // Group header row (merge adjacent leaves sharing a group label).
  let i = 0;
  while (i < cols.length) {
    const group = cols[i]!.group;
    let span = 1;
    while (i + span < cols.length && cols[i + span]!.group === group) span++;
    const x = colX(cols, i);
    const w = cols.slice(i, i + span).reduce((a, c) => a + c.width, 0);
    centeredText(p, group, x, w, bodyTop + HEADER_H - 11, 6.5, bold);
    i += span;
  }
  // Sub-header row.
  cols.forEach((c, idx) => {
    if (c.sub) centeredText(p, c.sub, colX(cols, idx), c.width, bodyTop + 4, 6, font, GREY);
  });

  // Vertical lines. Group boundaries (and outer edges) run the full height;
  // internal sub-column boundaries start below the group-header band so they do
  // not slice through the merged group labels.
  const midDivider = bodyTop + 13;
  for (let k = 0; k <= cols.length; k++) {
    const isGroupBoundary =
      k === 0 || k === cols.length || cols[k - 1]!.group !== cols[k]!.group;
    vline(p, colX(cols, k), isGroupBoundary ? gridTop : midDivider, totalsBottom);
  }
  // Mid-header divider (between group row and sub-header row).
  hline(p, MARGIN, MARGIN + gridW, midDivider);

  // Horizontal lines: top, header bottom, each row, totals.
  hline(p, MARGIN, MARGIN + gridW, gridTop);
  hline(p, MARGIN, MARGIN + gridW, bodyTop);
  for (let r = 0; r <= rowsPerPage; r++) hline(p, MARGIN, MARGIN + gridW, bodyTop - r * ROW_H);

  // Entry rows. Flight rows only; FSTD sessions are listed in their own table.
  const LINK = rgb(0.13, 0.32, 0.78); // approximate Tailwind sky-700, for the "signed" link.
  const MISSING = rgb(0.75, 0.13, 0.13);
  page.rows.forEach((row, r) => {
    const y = bodyTop - (r + 1) * ROW_H + 5;
    const e = row as LogbookEntryForPdf;
    cols.forEach((c, idx) => {
      const x = colX(cols, idx);
      let text = "";
      if (c.group === "DATE") {
        text = formatLogbookDate(e.departureTime);
      } else if (c.group === "REMARKS") {
        text = remarksText(e);
      } else if (c.group === "AIRCRAFT" && c.sub === "Type") {
        text = e.aircraftType ?? "";
      } else if (c.group === "AIRCRAFT" && c.sub === "Reg") {
        text = e.aircraftReg ?? "";
      } else if (c.group === "BALLOON" && c.sub === "Reg") {
        // The balloon layout drops the Type column and uses one combined cell.
        text = `${e.aircraftReg ?? ""}${e.aircraftType ? ` ${e.aircraftType}` : ""}`;
      } else if (c.group === "NAME PIC") {
        text = e.picName ?? "";
      } else {
        text = c.value(row);
      }
      const leftAligned =
        c.group === "REMARKS" || c.group === "NAME PIC" || c.group === "AIRCRAFT" || c.group === "BALLOON" || c.group === "DATE";
      if (c.group === "REMARKS") {
        // Reserve a small strip at the right of the remarks cell for the
        // "signed" / "missing" tag and draw the free-text part clipped to fit.
        const TAG_W = e.signed || e.signatureMissing ? 36 : 0;
        leftText(p, text, x, c.width - TAG_W, y, 6.5, font);
        if (e.signed) {
          const label = "signed";
          const lw = bold.widthOfTextAtSize(label, 6.5);
          const lx = x + c.width - TAG_W + 2;
          p.drawText(label, { x: lx, y, size: 6.5, font: bold, color: LINK });
          p.drawLine({ start: { x: lx, y: y - 1 }, end: { x: lx + lw, y: y - 1 }, color: LINK, thickness: 0.4 });
          // Record the clickable rect (in PDF page coords) so a later pass can
          // wire it to the appendix block for this entry.
          if (linkCtx && toPdfRect && e.entryId) {
            linkCtx.rowRects.set(e.entryId, {
              page: p,
              rect: toPdfRect(lx - 1, y - 2, lw + 2, 9),
            });
          }
        } else if (e.signatureMissing) {
          const label = "missing";
          const lx = x + c.width - TAG_W + 2;
          p.drawText(label, { x: lx, y, size: 6.5, font: bold, color: MISSING });
        }
      } else if (leftAligned) {
        leftText(p, text, x, c.width, y, 6.5, font);
      } else {
        centeredText(p, text, x, c.width, y, 6.5, font);
      }
    });
  });

  // Totals block.
  const totalRows: Array<{ label: string; totals: ColumnTotals }> = [
    { label: "TOTAL THIS PAGE", totals: page.thisPage },
    { label: "TOTAL FROM PREVIOUS PAGES", totals: page.broughtForward },
    { label: "TOTAL TIME", totals: page.carriedForward },
  ];
  totalRows.forEach((tr, idx) => {
    const rowTop = bodyBottom - idx * TOTAL_ROW_H;
    const y = rowTop - TOTAL_ROW_H + 5;
    p.drawRectangle({ x: MARGIN, y: rowTop - TOTAL_ROW_H, width: gridW, height: TOTAL_ROW_H, color: SHADE });
    hline(p, MARGIN, MARGIN + gridW, rowTop);
    p.drawText(tr.label, { x: MARGIN + 4, y, size: 7, font: bold, color: BLACK });
    cols.forEach((c, ci) => {
      if (c.totalKey) centeredText(p, MIN_OR_NUM(c.totalKey, tr.totals[c.totalKey]), colX(cols, ci), c.width, y, 6.5, bold);
      else if (c.totalValue) centeredText(p, c.totalValue(tr.totals), colX(cols, ci), c.width, y, 6.5, bold);
    });
  });
  hline(p, MARGIN, MARGIN + gridW, totalsBottom);
  void allEntries;
}

// Landings are counts; everything else summable is minutes.
function MIN_OR_NUM(key: SummableField, v: number): string {
  return key === "dayLandings" || key === "nightLandings" ? NUM(v) : MIN(v);
}

function drawSignatureBlock(
  p: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  topY: number,
  pageW: number,
  pilotName: string,
): void {
  const x = MARGIN;
  const w = pageW - 2 * MARGIN;
  p.drawRectangle({ x, y: topY - SIG_H, width: w, height: SIG_H, borderColor: BLACK, borderWidth: 0.5 });
  p.drawText("I certify that the entries in this log are a true record of the flights shown on this page.", {
    x: x + 8,
    y: topY - 16,
    size: 8,
    font,
    color: BLACK,
  });

  const lineY = topY - 48;
  // Pilot signature line.
  hline(p, x + 8, x + 220, lineY);
  p.drawText("Pilot signature", { x: x + 8, y: lineY - 11, size: 7, font, color: GREY });
  p.drawText(pilotName, { x: x + 12, y: lineY + 4, size: 8, font, color: BLACK });
  // Date line.
  hline(p, x + 250, x + 360, lineY);
  p.drawText("Date (UTC)", { x: x + 250, y: lineY - 11, size: 7, font, color: GREY });
  // Certifying/examiner line (for signed-off training pages).
  hline(p, x + 400, x + w - 8, lineY);
  p.drawText("Instructor / Examiner signature & licence no. (if applicable)", {
    x: x + 400,
    y: lineY - 11,
    size: 7,
    font,
    color: GREY,
  });
  void bold;
}

/**
 * Attach a PDF Link annotation pointing from a rect on the source page to a
 * specific y on the target page. Used to jump from a row's "signed" tag in the
 * remarks column to that entry's block in the sign-offs appendix.
 */
function addInternalLink(
  doc: PDFDocument,
  sourcePage: PDFPage,
  rect: [number, number, number, number],
  targetPage: PDFPage,
  targetY: number,
): void {
  const linkDict = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    Dest: [targetPage.ref, "XYZ", null, targetY, null],
  });
  const linkRef = doc.context.register(linkDict);
  const existing = sourcePage.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) {
    existing.push(linkRef);
  } else {
    sourcePage.node.set(PDFName.of("Annots"), doc.context.obj([linkRef]));
  }
}
