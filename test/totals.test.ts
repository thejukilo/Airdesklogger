import { describe, it, expect } from "vitest";
import { paginate } from "../src/domain/totals.js";
import type { DerivedColumns } from "../src/domain/types.js";

function row(total: number, pic: number): DerivedColumns {
  return {
    kind: "FLIGHT",
    attributes: [],
    enteredInLocalTime: false,
    signatureRequired: false,
    crewSize: 2,
    date: "2026-05-25",
    departurePlace: "EGKB",
    departureTime: new Date("2026-05-25T08:00:00Z"),
    arrivalPlace: "EGKB",
    arrivalTime: new Date("2026-05-25T09:00:00Z"),
    singleEngine: total,
    multiEngine: 0,
    multiPilot: 0,
    total,
    dayLandings: 1,
    nightLandings: 0,
    night: 0,
    ifr: 0,
    pic,
    coPilot: 0,
    dual: 0,
    instructor: 0,
    isMultiFlight: false,
  };
}

describe("page-by-page totals with carry-over", () => {
  const entries = [row(60, 60), row(90, 90), row(30, 0), row(45, 45), row(120, 120)];

  it("splits into pages of the requested size", () => {
    const { pages } = paginate(entries, 2);
    expect(pages.map((p) => p.rows.length)).toEqual([2, 2, 1]);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });

  it("computes TOTAL THIS PAGE per page", () => {
    const { pages } = paginate(entries, 2);
    expect(pages[0]!.thisPage.total).toBe(150);
    expect(pages[1]!.thisPage.total).toBe(75);
    expect(pages[2]!.thisPage.total).toBe(120);
  });

  it("brought-forward equals previous page's carried-forward", () => {
    const { pages } = paginate(entries, 2);
    expect(pages[0]!.broughtForward.total).toBe(0);
    expect(pages[1]!.broughtForward.total).toBe(pages[0]!.carriedForward.total);
    expect(pages[2]!.broughtForward.total).toBe(pages[1]!.carriedForward.total);
  });

  it("carried-forward accumulates correctly and matches the grand total", () => {
    const { pages, grandTotal } = paginate(entries, 2);
    expect(pages[0]!.carriedForward.total).toBe(150);
    expect(pages[1]!.carriedForward.total).toBe(225);
    expect(pages[2]!.carriedForward.total).toBe(345);
    expect(grandTotal.total).toBe(345);
    expect(grandTotal.pic).toBe(315);
  });

  it("handles an empty logbook", () => {
    const { pages, grandTotal } = paginate([], 10);
    expect(pages).toEqual([]);
    expect(grandTotal.total).toBe(0);
  });

  it("packs by row units when an entry's remarks make it taller", () => {
    // Row index 1 takes 2 units (wrapped remarks); page holds 3 units.
    const unitsOf = (_e: DerivedColumns, i: number) => (i === 1 ? 2 : 1);
    const withIndex = entries.map((e, i) => ({ e, u: unitsOf(e, i) }));
    const { pages } = paginate(entries, 3, (e) => withIndex.find((w) => w.e === e)!.u);
    // Page 1: rows 0 (1u) + 1 (2u) = 3 units. Page 2: rows 2,3,4 (3u).
    expect(pages.map((p) => p.rows.length)).toEqual([2, 3]);
    // Totals still thread through correctly across the height-based split.
    expect(pages[0]!.thisPage.total).toBe(150);
    expect(pages[1]!.carriedForward.total).toBe(345);
  });

  it("still fits a single entry taller than a page onto one page", () => {
    const { pages } = paginate([row(60, 60)], 2, () => 5);
    expect(pages.length).toBe(1);
    expect(pages[0]!.rows.length).toBe(1);
  });
});
