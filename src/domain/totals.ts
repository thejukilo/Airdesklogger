/**
 * Page-by-page totals with carry-over, exactly as the paper EASA logbook works.
 *
 * Each page shows three total rows for every summable column:
 *   - TOTAL THIS PAGE: the sum of the rows printed on this page.
 *   - TOTAL FROM PREVIOUS PAGES: the grand total brought forward from earlier pages.
 *   - TOTAL TIME: brought-forward plus this-page, which is then carried to the next page.
 *
 * The carried-forward total of one page is the brought-forward total of the next,
 * so the running grand total threads through the whole logbook without rounding
 * (all values are integer minutes / counts).
 */

import { SUMMABLE_FIELDS, type SummableField } from "./columns.js";
import type { DerivedColumns } from "./types.js";

export type ColumnTotals = Record<SummableField, number>;

function zeroTotals(): ColumnTotals {
  return Object.fromEntries(SUMMABLE_FIELDS.map((f) => [f, 0])) as ColumnTotals;
}

function rowValues(e: DerivedColumns): ColumnTotals {
  return {
    singleEngine: e.singleEngine,
    multiEngine: e.multiEngine,
    multiPilot: e.multiPilot,
    total: e.total,
    dayLandings: e.dayLandings,
    nightLandings: e.nightLandings,
    night: e.night,
    ifr: e.ifr,
    pic: e.pic,
    coPilot: e.coPilot,
    dual: e.dual,
    instructor: e.instructor,
    fstdTotal: e.fstd?.totalMinutes ?? 0,
    balloonGroupA: e.balloonGroupA ?? 0,
    balloonGroupB: e.balloonGroupB ?? 0,
    balloonGroupC: e.balloonGroupC ?? 0,
    balloonGroupD: e.balloonGroupD ?? 0,
    balloonGas: e.balloonGas ?? 0,
  };
}

function addInto(acc: ColumnTotals, v: ColumnTotals): void {
  for (const f of SUMMABLE_FIELDS) acc[f] += v[f];
}

export interface LogbookPage {
  pageNumber: number;
  rows: DerivedColumns[];
  thisPage: ColumnTotals; // TOTAL THIS PAGE
  broughtForward: ColumnTotals; // TOTAL FROM PREVIOUS PAGES
  carriedForward: ColumnTotals; // TOTAL TIME (forward to next page)
}

export interface PaginatedLogbook {
  pages: LogbookPage[];
  grandTotal: ColumnTotals;
}

/**
 * Split entries into pages and compute carry-over totals. Each entry occupies a
 * whole number of row "units" (`unitsOf`, default 1); an entry whose remarks
 * wrap onto extra lines takes more than one unit, and entries are packed so the
 * units on a page never exceed `rowsPerPage`. With the default this is the plain
 * fixed `rowsPerPage` split.
 */
export function paginate(
  entries: readonly DerivedColumns[],
  rowsPerPage: number,
  unitsOf?: (e: DerivedColumns) => number,
): PaginatedLogbook {
  if (rowsPerPage < 1) throw new Error("rowsPerPage must be >= 1");
  // One entry can never take more units than a page holds, so a very long
  // remark still lands (it fills its page rather than vanishing).
  const unitsFor = (e: DerivedColumns) =>
    Math.max(1, Math.min(rowsPerPage, Math.floor(unitsOf ? unitsOf(e) : 1)));

  const pages: LogbookPage[] = [];
  let broughtForward = zeroTotals();

  let i = 0;
  let page = 1;
  while (i < entries.length) {
    const rows: DerivedColumns[] = [];
    let used = 0;
    while (i < entries.length) {
      const u = unitsFor(entries[i]!);
      if (used > 0 && used + u > rowsPerPage) break;
      rows.push(entries[i]!);
      used += u;
      i++;
    }

    const thisPage = zeroTotals();
    for (const e of rows) addInto(thisPage, rowValues(e));

    const carriedForward = zeroTotals();
    addInto(carriedForward, broughtForward);
    addInto(carriedForward, thisPage);

    pages.push({
      pageNumber: page,
      rows,
      thisPage,
      broughtForward: { ...broughtForward },
      carriedForward,
    });
    broughtForward = { ...carriedForward };
    page++;
  }

  return { pages, grandTotal: broughtForward };
}
