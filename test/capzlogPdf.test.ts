import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractCapzlogPdf, type CapzlogTextItem } from "../src/import/capzlogPdf.js";
import { mapCapzlogPdfRows } from "../src/http/capzlog.js";

// Positioned text items captured from a real capzlog "Airplane Flights Report"
// PDF (27 flights). The report prints its own totals, which we assert against.
const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(
  readFileSync(join(here, "fixtures/capzlog-airplane-items.json"), "utf8"),
) as CapzlogTextItem[];

const blockMinutes = (iso1: string, iso2: string) =>
  Math.round((Date.parse(iso2) - Date.parse(iso1)) / 60000);

describe("capzlog Airplane PDF import", () => {
  const extract = extractCapzlogPdf(items);

  it("detects the airplane report and extracts all 27 flights", () => {
    expect(extract.report).toBe("airplane");
    expect(extract.rows.length).toBe(27);
    expect(extract.holder).toBe("Lode Van de Velde");
  });

  it("maps every row to a valid flight entry with no issues", () => {
    const mapped = mapCapzlogPdfRows(extract.rows, {});
    expect(mapped).toHaveLength(27);
    expect(mapped.every((r) => r.ok)).toBe(true);
    expect(mapped.every((r) => r.kind === "FLIGHT")).toBe(true);
  });

  it("reproduces the totals the report prints (block 20:59, 85 landings, all Dual)", () => {
    const mapped = mapCapzlogPdfRows(extract.rows, {});
    const totalBlock = mapped.reduce((s, r) => {
      const leg = r.entry!.legs[0];
      return s + blockMinutes(leg.departureTime, leg.arrivalTime);
    }, 0);
    const totalLandings = mapped.reduce((s, r) => s + r.entry!.landings.day, 0);
    expect(totalBlock).toBe(20 * 60 + 59); // 20:59 = 1259 min
    expect(totalLandings).toBe(85);
    expect(mapped.every((r) => r.entry!.function.primary === "DUAL")).toBe(true);
  });

  it("maps aircraft, route, times and PIC correctly on the first flight", () => {
    const e = mapCapzlogPdfRows(extract.rows, {})[0].entry!;
    expect(e.aircraft.registration).toBe("HB-SGZ");
    expect(e.aircraft.makeModelVariant).toBe("A210");
    expect(e.aircraft.engineClass).toBe("SE");
    expect(e.aircraft.category).toBe("AEROPLANE");
    expect(e.legs[0]).toMatchObject({
      departurePlace: "LSZN",
      arrivalPlace: "LSZN",
      departureTime: "2024-09-06T09:15:00Z",
      arrivalTime: "2024-09-06T10:04:00Z",
    });
    expect(e.picName).toBe("Epp Sascha");
    expect(e.landings.day).toBe(1);
  });

  it("rejects a report with no Airplane section", () => {
    const sim = extractCapzlogPdf([{ str: "Simulator Sessions Report", x: 22, y: 75, w: 120 }]);
    expect(sim.report).toBe("unknown");
    expect(sim.rows).toHaveLength(0);
    expect(sim.warnings[0]).toMatch(/only Airplane/i);
  });
});

describe("capzlog combined (multi-category) PDF import", () => {
  const combined = JSON.parse(
    readFileSync(join(here, "fixtures/capzlog-combined-items.json"), "utf8"),
  ) as CapzlogTextItem[];
  const ex = extractCapzlogPdf(combined);

  it("extracts ONLY the Airplane Flights section from a 13-page combined report", () => {
    // The export also has Airplane FSTD, Helicopter, Sailplane and Balloon
    // sections plus References/Markers pages — none of which must leak in.
    expect(ex.report).toBe("airplane");
    expect(ex.rows).toHaveLength(3);
    const w = ex.warnings.join(" ");
    expect(w).toMatch(/only the Airplane flights were read/i);
    expect(w).toMatch(/helicopter/i);
    expect(w).toMatch(/balloon/i);
  });

  it("maps the 3 airplane flights cleanly, none from other sections", () => {
    const mapped = mapCapzlogPdfRows(ex.rows, {});
    expect(mapped).toHaveLength(3);
    expect(mapped.every((r) => r.ok)).toBe(true);
    expect(mapped.every((r) => r.entry!.aircraft.registration === "HB-SGZ")).toBe(true);
    expect(mapped.every((r) => r.entry!.function.primary === "PIC")).toBe(true);
  });
});
