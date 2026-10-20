import { describe, it, expect } from "vitest";
import { matchesFilter, isActive, FIELD_MAP, type FilterSpec, type Condition } from "../web/src/lib/logbookFilter";
import type { EntryRow } from "../web/src/api";

/**
 * The filter engine is pure and runs client-side over what listEntries already
 * returns, so these tests build plain EntryRow-shaped objects and assert the
 * operators behave per data type.
 */

function makeRow(content: Record<string, unknown>, extra: Partial<EntryRow> = {}): EntryRow {
  return {
    id: extra.id ?? "00000000-0000-0000-0000-000000000001",
    locked: extra.locked ?? false,
    content: content as EntryRow["content"],
    import_source: extra.import_source ?? null,
    voided: false,
  } as EntryRow;
}

const flight = makeRow({
  pilotId: "p",
  picName: "SELF",
  remarks: "night nav to EDDF",
  aircraft: { registration: "HB-ABC", makeModelVariant: "Cessna 172", category: "AEROPLANE" },
  function: { primary: "PIC" },
  columns: {
    date: "2026-09-14",
    departurePlace: "LSZH",
    arrivalPlace: "EDDF",
    total: 115,
    night: 40,
    ifr: 0,
    pic: 115,
    coPilot: 0,
    dual: 0,
    instructor: 0,
    dayLandings: 1,
    nightLandings: 1,
    crewSize: 2,
    category: "AEROPLANE",
    attributes: ["cross_country"],
  },
});

const sim = makeRow(
  {
    pilotId: "p",
    remarks: "LPC",
    columns: {
      date: "2026-08-01",
      attributes: ["proficiency_check"],
      signatureRequired: true,
      fstd: { deviceType: "A320", qualificationNumber: "CH-345", totalMinutes: 90 },
    },
  },
  { locked: false },
);

const spec = (...conditions: Condition[]): FilterSpec => ({ match: "AND", conditions });
const c = (field: string, op: Condition["op"], value?: Condition["value"]): Condition =>
  ({ id: Math.random().toString(36), field, op, value });

describe("text operators", () => {
  it("contains / does not contain (case-insensitive)", () => {
    expect(matchesFilter(flight, spec(c("registration", "contains", "hb")))).toBe(true);
    expect(matchesFilter(flight, spec(c("registration", "contains", "xyz")))).toBe(false);
    expect(matchesFilter(flight, spec(c("registration", "notContains", "xyz")))).toBe(true);
  });
  it("is / starts with / ends with", () => {
    expect(matchesFilter(flight, spec(c("departure", "eq", "lszh")))).toBe(true);
    expect(matchesFilter(flight, spec(c("arrival", "startsWith", "ed")))).toBe(true);
    expect(matchesFilter(flight, spec(c("arrival", "endsWith", "df")))).toBe(true);
  });
});

describe("duration / number operators", () => {
  it("greater than / less than with hh:mm input", () => {
    expect(matchesFilter(flight, spec(c("total", "gt", "02:00")))).toBe(false); // 115 < 120
    expect(matchesFilter(flight, spec(c("total", "gt", "01:00")))).toBe(true); // 115 > 60
    expect(matchesFilter(flight, spec(c("total", "lt", "02:00")))).toBe(true);
  });
  it("between (inclusive)", () => {
    expect(matchesFilter(flight, spec(c("total", "between", ["01:00", "02:00"])))).toBe(true);
    expect(matchesFilter(flight, spec(c("night", "between", ["00:50", "01:30"])))).toBe(false); // 40 < 50
  });
  it("plain number field (landings)", () => {
    expect(matchesFilter(flight, spec(c("nightLandings", "gte", "1")))).toBe(true);
    expect(matchesFilter(flight, spec(c("dayLandings", "gt", "1")))).toBe(false);
  });
});

describe("date operators", () => {
  it("before / after / on / between", () => {
    expect(matchesFilter(flight, spec(c("date", "after", "2026-09-01")))).toBe(true);
    expect(matchesFilter(flight, spec(c("date", "before", "2026-09-01")))).toBe(false);
    expect(matchesFilter(flight, spec(c("date", "on", "2026-09-14")))).toBe(true);
    expect(matchesFilter(flight, spec(c("date", "between", ["2026-01-01", "2026-12-31"])))).toBe(true);
  });
});

describe("enum / boolean / attribute / kind", () => {
  it("category is / is not", () => {
    expect(matchesFilter(flight, spec(c("category", "is", "AEROPLANE")))).toBe(true);
    expect(matchesFilter(flight, spec(c("category", "isNot", "HELICOPTER")))).toBe(true);
    expect(matchesFilter(flight, spec(c("category", "isAnyOf", ["HELICOPTER", "SAILPLANE"])))).toBe(false);
  });
  it("kind distinguishes flights and FSTD sessions", () => {
    expect(matchesFilter(sim, spec(c("kind", "is", "FSTD")))).toBe(true);
    expect(matchesFilter(flight, spec(c("kind", "is", "FSTD")))).toBe(false);
  });
  it("signed / signature-missing booleans", () => {
    expect(matchesFilter(flight, spec(c("signed", "isTrue")))).toBe(false);
    expect(matchesFilter(makeRow(flight.content as Record<string, unknown>, { locked: true }), spec(c("signed", "isTrue")))).toBe(true);
    expect(matchesFilter(sim, spec(c("signatureMissing", "isTrue")))).toBe(true);
  });
  it("attribute has / has any of / has all of", () => {
    expect(matchesFilter(flight, spec(c("attribute", "has", "cross_country")))).toBe(true);
    expect(matchesFilter(flight, spec(c("attribute", "has", "towing")))).toBe(false);
    expect(matchesFilter(flight, spec(c("attribute", "notHas", "towing")))).toBe(true);
    expect(matchesFilter(sim, spec(c("attribute", "hasAnyOf", ["proficiency_check", "skill_test"])))).toBe(true);
  });
});

describe("combination and inactive conditions", () => {
  it("combines conditions with AND", () => {
    const f = spec(c("category", "is", "AEROPLANE"), c("total", "gt", "01:00"), c("attribute", "has", "cross_country"));
    expect(matchesFilter(flight, f)).toBe(true);
    const f2 = spec(c("category", "is", "AEROPLANE"), c("total", "gt", "03:00"));
    expect(matchesFilter(flight, f2)).toBe(false);
  });
  it("ignores empty / unparseable conditions instead of matching nothing", () => {
    expect(isActive(c("registration", "contains", ""), FIELD_MAP.registration!)).toBe(false);
    expect(isActive(c("total", "gt", "abc"), FIELD_MAP.total!)).toBe(false);
    // An incomplete condition does not filter the row out.
    expect(matchesFilter(flight, spec(c("registration", "contains", "")))).toBe(true);
    expect(matchesFilter(flight, spec(c("total", "gt", "")))).toBe(true);
  });
});
