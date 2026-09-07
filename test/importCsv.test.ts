import { describe, it, expect } from "vitest";
import { parseCsv, mapCsvRow, parseImportCsv, CSV_COLUMNS } from "../src/http/importCsv.js";

const HEADER = CSV_COLUMNS.join(",");

function file(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseCsv", () => {
  it("reads simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and quotes", () => {
    const rows = parseCsv('a,b\n"hello, world","she said ""hi"""');
    expect(rows[1]).toEqual(["hello, world", 'she said "hi"']);
  });

  it("handles embedded newlines inside quotes", () => {
    const rows = parseCsv('a,b\n"line1\nline2",x');
    expect(rows[1]).toEqual(["line1\nline2", "x"]);
  });

  it("tolerates CRLF and a trailing newline and a BOM", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapCsvRow", () => {
  const headers = CSV_COLUMNS.slice();

  function row(overrides: Partial<Record<string, string>> = {}): string[] {
    const base: Record<string, string> = {
      external_id: "LEGACY-1",
      date: "2020-05-01",
      off_block_utc: "08:15",
      on_block_utc: "09:40",
      departure_icao: "LSZH",
      arrival_icao: "LSGG",
      registration: "HB-PNT",
      type: "Cessna 172S",
      engine_class: "SE",
      multi_pilot: "false",
      category: "AEROPLANE",
      pic_name: "SELF",
      function: "PIC",
      day_landings: "1",
      night_landings: "0",
      night_minutes: "0",
      ifr_minutes: "0",
      instructor_minutes: "0",
      remarks: "test",
      attributes: "cross_country solo",
    };
    return headers.map((h) => overrides[h] ?? base[h] ?? "");
  }

  it("maps a valid row into an entry", () => {
    const r = mapCsvRow(headers, row(), 2);
    expect(r.ok).toBe(true);
    expect(r.externalId).toBe("LEGACY-1");
    expect(r.entry?.aircraft).toMatchObject({ registration: "HB-PNT", engineClass: "SE", multiPilot: false, category: "AEROPLANE" });
    expect(r.entry?.legs[0]).toMatchObject({
      departurePlace: "LSZH",
      departureTime: "2020-05-01T08:15:00Z",
      arrivalPlace: "LSGG",
      arrivalTime: "2020-05-01T09:40:00Z",
    });
    expect(r.entry?.attributes).toEqual(["cross_country", "solo"]);
  });

  it("rolls the arrival to the next day when it crosses midnight", () => {
    const r = mapCsvRow(headers, row({ off_block_utc: "23:30", on_block_utc: "00:45" }), 2);
    expect(r.ok).toBe(true);
    expect(r.entry?.legs[0]?.departureTime).toBe("2020-05-01T23:30:00Z");
    expect(r.entry?.legs[0]?.arrivalTime).toBe("2020-05-02T00:45:00Z");
  });

  it("defaults blank pic_name to SELF and blank category to AEROPLANE", () => {
    const r = mapCsvRow(headers, row({ pic_name: "", category: "" }), 2);
    expect(r.ok).toBe(true);
    expect(r.entry?.picName).toBe("SELF");
    expect(r.entry?.aircraft.category).toBe("AEROPLANE");
  });

  it("reports every bad field at once", () => {
    const r = mapCsvRow(headers, row({ date: "01/05/2020", engine_class: "single", function: "captain", off_block_utc: "8h" }), 2);
    expect(r.ok).toBe(false);
    const fields = (r.issues ?? []).map((i) => i.field).sort();
    expect(fields).toEqual(["date", "engine_class", "function", "off_block_utc"]);
  });

  it("rejects an IATA-style 3-letter code but accepts ZZZZ", () => {
    expect(mapCsvRow(headers, row({ departure_icao: "ZRH" }), 2).ok).toBe(false);
    expect(mapCsvRow(headers, row({ departure_icao: "ZZZZ" }), 2).ok).toBe(true);
  });
});

describe("parseImportCsv", () => {
  it("flags a missing required column", () => {
    const bad = "date,off_block_utc\n2020-05-01,08:15";
    expect(parseImportCsv(bad).fatal).toMatch(/missing required column/i);
  });

  it("flags a header-only file", () => {
    expect(parseImportCsv(HEADER).fatal).toMatch(/no flights/i);
  });

  it("parses a good file with per-row results", () => {
    const good = file(
      "L1,2020-05-01,08:15,09:40,LSZH,LSGG,HB-PNT,Cessna 172S,SE,false,AEROPLANE,SELF,PIC,1,0,0,0,0,ok,",
      "L2,2020-05-02,10:00,10:30,ZRH,LSGG,HB-PNT,Cessna 172S,SE,false,AEROPLANE,SELF,PIC,1,0,0,0,0,bad dep,",
    );
    const parsed = parseImportCsv(good);
    expect(parsed.fatal).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.ok).toBe(true);
    expect(parsed.rows[0]?.line).toBe(2);
    expect(parsed.rows[1]?.ok).toBe(false);
    expect(parsed.rows[1]?.line).toBe(3);
  });
});
