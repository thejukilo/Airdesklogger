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
const TIME = (d: Date) => d.toISOString().slice(11, 16) + "Z"; // HH:MM UTC, Z = Zulu

const COLUMNS: LeafColumn[] = [
  { group: "DATE", sub: "dd/mm/yy", width: 58, value: (e) => formatLogbookDate(e.departureTime) },
  { group: "DEPARTURE", sub: "Place", width: 44, value: (e) => e.departurePlace },
  { group: "DEPARTURE", sub: "Time", width: 38, value: (e) => TIME(e.departureTime) },
  { group: "ARRIVAL", sub: "Place", width: 44, value: (e) => e.arrivalPlace },
  { group: "ARRIVAL", sub: "Time", width: 38, value: (e) => TIME(e.arrivalTime) },
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
  { group: "FSTD SESSION", sub: "Date", width: 44, value: (e) => (e.fstd ? fmtIsoDate(e.fstd.date) : "") },
  { group: "FSTD SESSION", sub: "Type", width: 78, value: (e) => (e.fstd ? `${e.fstd.deviceType} (${e.fstd.qualificationNumber})` : "") },
  { group: "FSTD SESSION", sub: "Total", width: 42, value: (e) => (e.fstd ? MIN(e.fstd.totalMinutes) : ""), totalKey: "fstdTotal" },
  { group: "REMARKS", sub: "& endorsements", width: 150, value: () => "" },
];

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
  if (e.signatureRequired && !e.signed) parts.push("(signature required)");
  else if (e.signed) parts.push("(signed off)");
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
  aircraftType: string;
  aircraftReg: string;
  picName: string;
  remarks: string;
  /** Whether a valid sign-off exists; used to flag a missing required signature. */
  signed?: boolean;
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
export interface AuditAppendix {
  signoffs: Array<{ entry: string; text: string }>;
  changeLog: Array<{ entry: string; text: string }>;
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

  const paginated = paginate(entries, rowsPerPage);
  const pages = paginated.pages.length > 0 ? paginated.pages : [emptyPage()];

  for (const page of pages) {
    drawPage(doc, font, bold, page, pages.length, resolved, entries);
  }

  if (audit) {
    const portrait = PAGE_PORTRAIT[paper];
    if (audit.signoffs.length > 0) {
      drawAppendix(doc, font, bold, "SIGN-OFFS", audit.signoffs, opts.pilotName, portrait);
    }
    // The change log is a mandatory part of the export (FOCA 2.3.7).
    drawAppendix(doc, font, bold, "CHANGE LOG", audit.changeLog, opts.pilotName, portrait);
  }

  return doc.save();
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
): void {
  const paper = opts.paperSize ?? "A4";
  const rowsPerPage = opts.rowsPerPage ?? rowsToFillPage(paper);
  const gridH = HEADER_H + rowsPerPage * ROW_H + 3 * TOTAL_ROW_H;
  const contentW = CONTENT_W;
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
  p.drawText("EASA FLIGHT CREW LOGBOOK  -  AMC1 FCL.050", { x: MARGIN, y: top - 10, size: 11, font: bold, color: BLACK });
  p.drawText(
    `Holder: ${opts.pilotName}${opts.dateOfBirth ? `    DOB: ${opts.dateOfBirth}` : ""}` +
      `${opts.licenseNumber ? `    Licence: ${opts.licenseNumber}` : ""}` +
      `${opts.holderAddress ? `    Address: ${opts.holderAddress}` : ""}    All times in UTC (Z = Zulu)`,
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
  drawGrid(p, font, bold, gridTop, page, rowsPerPage, allEntries);
  drawSignatureBlock(p, font, bold, gridTop - gridH - 14, contentW, opts.pilotName);

  p.pushOperators(popGraphicsState());
}

function colX(index: number): number {
  let x = MARGIN;
  for (let i = 0; i < index; i++) x += COLUMNS[i]!.width;
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
): void {
  const bodyTop = gridTop - HEADER_H;
  const bodyBottom = bodyTop - rowsPerPage * ROW_H;
  const totalsBottom = bodyBottom - 3 * TOTAL_ROW_H;

  // Header shading.
  p.drawRectangle({ x: MARGIN, y: bodyTop, width: GRID_W, height: HEADER_H, color: SHADE });

  // Group header row (merge adjacent leaves sharing a group label).
  let i = 0;
  while (i < COLUMNS.length) {
    const group = COLUMNS[i]!.group;
    let span = 1;
    while (i + span < COLUMNS.length && COLUMNS[i + span]!.group === group) span++;
    const x = colX(i);
    const w = COLUMNS.slice(i, i + span).reduce((a, c) => a + c.width, 0);
    centeredText(p, group, x, w, bodyTop + HEADER_H - 11, 6.5, bold);
    i += span;
  }
  // Sub-header row.
  COLUMNS.forEach((c, idx) => {
    if (c.sub) centeredText(p, c.sub, colX(idx), c.width, bodyTop + 4, 6, font, GREY);
  });

  // Vertical lines. Group boundaries (and outer edges) run the full height;
  // internal sub-column boundaries start below the group-header band so they do
  // not slice through the merged group labels.
  const midDivider = bodyTop + 13;
  for (let k = 0; k <= COLUMNS.length; k++) {
    const isGroupBoundary =
      k === 0 || k === COLUMNS.length || COLUMNS[k - 1]!.group !== COLUMNS[k]!.group;
    vline(p, colX(k), isGroupBoundary ? gridTop : midDivider, totalsBottom);
  }
  // Mid-header divider (between group row and sub-header row).
  hline(p, MARGIN, MARGIN + GRID_W, midDivider);

  // Horizontal lines: top, header bottom, each row, totals.
  hline(p, MARGIN, MARGIN + GRID_W, gridTop);
  hline(p, MARGIN, MARGIN + GRID_W, bodyTop);
  for (let r = 0; r <= rowsPerPage; r++) hline(p, MARGIN, MARGIN + GRID_W, bodyTop - r * ROW_H);

  // Entry rows. An FSTD row leaves the flight columns blank and fills only the
  // date, the FSTD column and the remarks; a flight row leaves the FSTD column
  // blank. This mirrors how the paper logbook records a simulator session.
  page.rows.forEach((row, r) => {
    const y = bodyTop - (r + 1) * ROW_H + 5;
    const e = row as LogbookEntryForPdf;
    const isFstd = e.kind === "FSTD";
    COLUMNS.forEach((c, idx) => {
      const x = colX(idx);
      let text = "";
      if (c.group === "DATE") {
        text = formatLogbookDate(e.departureTime);
      } else if (c.group === "FSTD SESSION") {
        text = c.value(row);
      } else if (c.group === "REMARKS") {
        text = remarksText(e);
      } else if (!isFstd) {
        if (c.group === "AIRCRAFT" && c.sub === "Type") text = e.aircraftType ?? "";
        else if (c.group === "AIRCRAFT" && c.sub === "Reg") text = e.aircraftReg ?? "";
        else if (c.group === "NAME PIC") text = e.picName ?? "";
        else text = c.value(row);
      }
      const leftAligned =
        c.group === "REMARKS" ||
        c.group === "NAME PIC" ||
        c.group === "AIRCRAFT" ||
        c.group === "DATE" ||
        (c.group === "FSTD SESSION" && c.sub === "Type");
      if (leftAligned) leftText(p, text, x, c.width, y, 6.5, font);
      else centeredText(p, text, x, c.width, y, 6.5, font);
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
    p.drawRectangle({ x: MARGIN, y: rowTop - TOTAL_ROW_H, width: GRID_W, height: TOTAL_ROW_H, color: SHADE });
    hline(p, MARGIN, MARGIN + GRID_W, rowTop);
    // Label spans columns up to the first summable column ("SINGLE-PILOT / SE").
    const labelSpanEnd = COLUMNS.findIndex((c) => c.totalKey);
    const labelW = COLUMNS.slice(0, labelSpanEnd).reduce((a, c) => a + c.width, 0);
    p.drawText(tr.label, { x: MARGIN + 4, y, size: 7, font: bold, color: BLACK });
    COLUMNS.forEach((c, ci) => {
      if (c.totalKey) centeredText(p, MIN_OR_NUM(c.totalKey, tr.totals[c.totalKey]), colX(ci), c.width, y, 6.5, bold);
      else if (c.totalValue) centeredText(p, c.totalValue(tr.totals), colX(ci), c.width, y, 6.5, bold);
    });
    void labelW;
  });
  hline(p, MARGIN, MARGIN + GRID_W, totalsBottom);
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
