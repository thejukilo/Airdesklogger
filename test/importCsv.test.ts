import { describe, it, expect } from "vitest";
import {
  parseCsv,
  mapCsvRow,
  parseImportCsv,
  normalizeDate,
  detectDateFormat,
  CSV_COLUMNS,
  type MapOptions,
} from "../src/http/importCsv.js";

const HEADER = CSV_COLUMNS.join(",");
const OPTS: MapOptions = { dateFormat: "YMD", selfName: null };

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

describe("normalizeDate", () => {
  it("passes ISO through", () => {
    expect(normalizeDate("2020-05-01", "YMD")).toBe("2020-05-01");
    expect(normalizeDate("2020-05-01", "DMY")).toBe("2020-05-01");
  });
  it("reads day-first with various separators", () => {
    expect(normalizeDate("01/05/2020", "DMY")).toBe("2020-05-01");
    expect(normalizeDate("1.5.2020", "DMY")).toBe("2020-05-01");
  });
  it("reads month-first", () => {
    expect(normalizeDate("05/01/2020", "MDY")).toBe("2020-05-01");
  });
  it("expands a 2-digit year with a 1970 pivot", () => {
    expect(normalizeDate("01/05/98", "DMY")).toBe("1998-05-01");
    expect(normalizeDate("01/05/20", "DMY")).toBe("2020-05-01");
  });
  it("rejects an impossible date", () => {
    expect(normalizeDate("31/02/2020", "DMY")).toBeNull();
    expect(normalizeDate("2020-13-01", "YMD")).toBeNull();
  });
});

describe("detectDateFormat", () => {
  it("detects ISO / year-first", () => {
    expect(detectDateFormat(["2020-05-01", "2021-06-02"])).toBe("YMD");
  });
  it("detects day-first when a day exceeds 12", () => {
    expect(detectDateFormat(["13/05/2020", "01/06/2021"])).toBe("DMY");
  });
  it("detects month-first when the second token exceeds 12", () => {
    expect(detectDateFormat(["05/13/2020", "06/01/2021"])).toBe("MDY");
  });
  it("defaults to day-first when ambiguous", () => {
    expect(detectDateFormat(["05/06/2020"])).toBe("DMY");
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
    const r = mapCsvRow(headers, row(), 2, OPTS);
    expect(r.ok).toBe(true);
    expect(r.needsAircraftLookup).toBe(false);
    expect(r.externalId).toBe("LEGACY-1");
    expect(r.entry?.aircraft).toMatchObject({ registration: "HB-PNT", engineClass: "SE", multiPilot: false, category: "AEROPLANE" });
    expect(r.entry?.legs[0]).toMatchObject({
      departureTime: "2020-05-01T08:15:00Z",
      arrivalTime: "2020-05-01T09:40:00Z",
    });
    expect(r.entry?.attributes).toEqual(["cross_country", "solo"]);
  });

  it("marks a row for aircraft lookup when the descriptors are blank", () => {
    const r = mapCsvRow(headers, row({ type: "", engine_class: "", category: "", multi_pilot: "" }), 2, OPTS);
    expect(r.ok).toBe(true);
    expect(r.needsAircraftLookup).toBe(true);
    expect(r.entry?.aircraft).toMatchObject({ makeModelVariant: "", engineClass: "", multiPilot: null, category: "" });
  });

  it("still validates a provided aircraft descriptor", () => {
    expect(mapCsvRow(headers, row({ engine_class: "single" }), 2, OPTS).ok).toBe(false);
    expect(mapCsvRow(headers, row({ category: "JET" }), 2, OPTS).ok).toBe(false);
  });

  it("rolls the arrival to the next day when it crosses midnight", () => {
    const r = mapCsvRow(headers, row({ off_block_utc: "23:30", on_block_utc: "00:45" }), 2, OPTS);
    expect(r.entry?.legs[0]?.departureTime).toBe("2020-05-01T23:30:00Z");
    expect(r.entry?.legs[0]?.arrivalTime).toBe("2020-05-02T00:45:00Z");
  });

  it("converts a matching PIC name to SELF but leaves others", () => {
    const opts: MapOptions = { dateFormat: "YMD", selfName: "Lode Vermeersch" };
    expect(mapCsvRow(headers, row({ pic_name: "lode vermeersch" }), 2, opts).entry?.picName).toBe("SELF");
    expect(mapCsvRow(headers, row({ pic_name: "M. Schmidt" }), 2, opts).entry?.picName).toBe("M. Schmidt");
  });

  it("applies the chosen date format", () => {
    const opts: MapOptions = { dateFormat: "DMY", selfName: null };
    const r = mapCsvRow(headers, row({ date: "01/05/2020" }), 2, opts);
    expect(r.entry?.legs[0]?.departureTime).toBe("2020-05-01T08:15:00Z");
  });

  it("reports every bad field at once", () => {
    const r = mapCsvRow(headers, row({ date: "nope", function: "captain", off_block_utc: "8h" }), 2, OPTS);
    expect(r.ok).toBe(false);
    const fields = (r.issues ?? []).map((i) => i.field).sort();
    expect(fields).toEqual(["date", "function", "off_block_utc"]);
  });

  it("rejects an IATA-style 3-letter code but accepts ZZZZ", () => {
    expect(mapCsvRow(headers, row({ departure_icao: "ZRH" }), 2, OPTS).ok).toBe(false);
    expect(mapCsvRow(headers, row({ departure_icao: "ZZZZ" }), 2, OPTS).ok).toBe(true);
  });
});

describe("parseImportCsv", () => {
  it("flags a missing required column", () => {
    const bad = "date,off_block_utc\n2020-05-01,08:15";
    expect(parseImportCsv(bad).fatal).toMatch(/missing required column/i);
  });

  it("does not require the aircraft descriptor columns", () => {
    const noAircraft =
      "date,off_block_utc,on_block_utc,departure_icao,arrival_icao,registration,function\n" +
      "2020-05-01,08:15,09:40,LSZH,LSGG,HB-PNT,PIC";
    const parsed = parseImportCsv(noAircraft);
    expect(parsed.fatal).toBeNull();
    expect(parsed.rows[0]?.ok).toBe(true);
    expect(parsed.rows[0]?.needsAircraftLookup).toBe(true);
  });

  it("flags a header-only file", () => {
    expect(parseImportCsv(HEADER).fatal).toMatch(/no flights/i);
  });

  it("auto-detects a day-first date column and reports it", () => {
    const good = file(
      "L1,13/05/2020,08:15,09:40,LSZH,LSGG,HB-PNT,Cessna 172S,SE,false,AEROPLANE,SELF,PIC,1,0,0,0,0,ok,",
    );
    const parsed = parseImportCsv(good);
    expect(parsed.dateFormat).toBe("DMY");
    expect(parsed.rows[0]?.ok).toBe(true);
    expect(parsed.rows[0]?.entry?.legs[0]?.departureTime).toBe("2020-05-13T08:15:00Z");
  });

  it("parses a good file with per-row results and line numbers", () => {
    const good = file(
      "L1,2020-05-01,08:15,09:40,LSZH,LSGG,HB-PNT,Cessna 172S,SE,false,AEROPLANE,SELF,PIC,1,0,0,0,0,ok,",
      "L2,2020-05-02,10:00,10:30,ZRH,LSGG,HB-PNT,Cessna 172S,SE,false,AEROPLANE,SELF,PIC,1,0,0,0,0,bad dep,",
    );
    const parsed = parseImportCsv(good);
    expect(parsed.rows[0]?.ok).toBe(true);
    expect(parsed.rows[0]?.line).toBe(2);
    expect(parsed.rows[1]?.ok).toBe(false);
    expect(parsed.rows[1]?.line).toBe(3);
  });
});
