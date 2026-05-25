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

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  totalKey?: SummableField; // present => participates in totals rows
}

const MIN = (m: number) => (m > 0 ? formatHHMM(m) : "");
const NUM = (n: number) => (n > 0 ? String(n) : "");
const TIME = (d: Date) => d.toISOString().slice(11, 16); // HH:MM UTC

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
  { group: "COND. TIME", sub: "Night", width: 40, value: (e) => MIN(e.night), totalKey: "night" },
  { group: "COND. TIME", sub: "IFR", width: 40, value: (e) => MIN(e.ifr), totalKey: "ifr" },
  { group: "FUNCTION TIME", sub: "PIC", width: 40, value: (e) => MIN(e.pic), totalKey: "pic" },
  { group: "FUNCTION TIME", sub: "Co", width: 40, value: (e) => MIN(e.coPilot), totalKey: "coPilot" },
  { group: "FUNCTION TIME", sub: "Dual", width: 40, value: (e) => MIN(e.dual), totalKey: "dual" },
  { group: "FUNCTION TIME", sub: "Instr", width: 40, value: (e) => MIN(e.instructor), totalKey: "instructor" },
  { group: "REMARKS", sub: "& endorsements", width: 150, value: () => "" },
];

const MARGIN = 28;
const HEADER_H = 30; // two-row column header
const ROW_H = 18;
const TOTAL_ROW_H = 16;
const SIG_H = 70;
const GRID_W = COLUMNS.reduce((a, c) => a + c.width, 0);

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.45, 0.45, 0.45);
const SHADE = rgb(0.93, 0.93, 0.93);

export interface LogbookEntryForPdf extends DerivedColumns {
  aircraftType: string;
  aircraftReg: string;
  picName: string;
  remarks: string;
}

export interface PdfOptions {
  pilotName: string;
  licenseNumber?: string;
  rowsPerPage?: number;
}

export async function generateLogbookPdf(
  entries: readonly LogbookEntryForPdf[],
  opts: PdfOptions,
): Promise<Uint8Array> {
  const rowsPerPage = opts.rowsPerPage ?? 12;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const paginated = paginate(entries, rowsPerPage);
  const pages = paginated.pages.length > 0 ? paginated.pages : [emptyPage()];

  for (const page of pages) {
    drawPage(doc, font, bold, page, pages.length, opts, entries);
  }

  return doc.save();
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
  const rowsPerPage = page.rows.length || (opts.rowsPerPage ?? 12);
  const gridH = HEADER_H + rowsPerPage * ROW_H + 3 * TOTAL_ROW_H;
  const pageW = GRID_W + 2 * MARGIN;
  const pageH = gridH + SIG_H + 3 * MARGIN + 24;
  const p = doc.addPage([pageW, pageH]);

  // Title / identity strip.
  let top = pageH - MARGIN;
  p.drawText("EASA FLIGHT CREW LOGBOOK  -  AMC1 FCL.050", { x: MARGIN, y: top - 10, size: 11, font: bold, color: BLACK });
  p.drawText(
    `Holder: ${opts.pilotName}${opts.licenseNumber ? `    Licence: ${opts.licenseNumber}` : ""}    All times UTC`,
    { x: MARGIN, y: top - 24, size: 8, font, color: GREY },
  );
  p.drawText(`Page ${page.pageNumber} of ${totalPages}`, {
    x: pageW - MARGIN - 70,
    y: top - 10,
    size: 9,
    font,
    color: BLACK,
  });

  const gridTop = top - 36;
  drawGrid(p, font, bold, gridTop, page, rowsPerPage, allEntries);
  drawSignatureBlock(p, font, bold, gridTop - gridH - 14, pageW, opts.pilotName);
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

  // Entry rows.
  page.rows.forEach((row, r) => {
    const y = bodyTop - (r + 1) * ROW_H + 5;
    const e = row as LogbookEntryForPdf;
    COLUMNS.forEach((c, idx) => {
      const x = colX(idx);
      let text = c.value(row);
      if (c.group === "AIRCRAFT" && c.sub === "Type") text = e.aircraftType ?? "";
      else if (c.group === "AIRCRAFT" && c.sub === "Reg") text = e.aircraftReg ?? "";
      else if (c.group === "NAME PIC") text = e.picName ?? "";
      else if (c.group === "REMARKS") text = e.remarks ?? "";
      if (c.group === "REMARKS" || c.group === "NAME PIC" || c.group === "AIRCRAFT" || c.group === "DATE") {
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
    p.drawRectangle({ x: MARGIN, y: rowTop - TOTAL_ROW_H, width: GRID_W, height: TOTAL_ROW_H, color: SHADE });
    hline(p, MARGIN, MARGIN + GRID_W, rowTop);
    // Label spans columns up to the first summable column ("SINGLE-PILOT / SE").
    const labelSpanEnd = COLUMNS.findIndex((c) => c.totalKey);
    const labelW = COLUMNS.slice(0, labelSpanEnd).reduce((a, c) => a + c.width, 0);
    p.drawText(tr.label, { x: MARGIN + 4, y, size: 7, font: bold, color: BLACK });
    COLUMNS.forEach((c, ci) => {
      if (c.totalKey) centeredText(p, MIN_OR_NUM(c.totalKey, tr.totals[c.totalKey]), colX(ci), c.width, y, 6.5, bold);
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
