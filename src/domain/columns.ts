/**
 * The 12 mandatory logbook columns of AMC1 FCL.050.
 *
 * EASA defines the logbook as a fixed matrix. Every persisted field maps to
 * exactly one of these columns (or a sub-field of one). This module is the
 * single source of truth for that mapping: the DB schema, validation, totals
 * and PDF layout all derive their column identities from here so the matrix
 * cannot drift between layers.
 */

export const LOGBOOK_COLUMNS = [
  { n: 1, id: "date", title: "DATE", note: "Date of flight (UTC), dd/mm/yyyy" },
  {
    n: 2,
    id: "departure",
    title: "DEPARTURE",
    sub: ["place", "time"],
    note: "Place (ICAO/name) and time in UTC",
  },
  {
    n: 3,
    id: "arrival",
    title: "ARRIVAL",
    sub: ["place", "time"],
    note: "Place (ICAO/name) and time in UTC",
  },
  {
    n: 4,
    id: "aircraft",
    title: "AIRCRAFT",
    sub: ["makeModelVariant", "registration"],
    note: "Make, model, variant (type) and registration",
  },
  {
    n: 5,
    id: "singlePilotTime",
    title: "SINGLE-PILOT TIME",
    sub: ["singleEngine", "multiEngine"],
    note: "Single-pilot single-engine / multi-engine time",
  },
  {
    n: 6,
    id: "multiPilotTime",
    title: "MULTI-PILOT TIME",
    note: "Time on multi-pilot aircraft / operations",
  },
  {
    n: 7,
    id: "totalTime",
    title: "TOTAL TIME OF FLIGHT",
    note: "Block (off-blocks to on-blocks) total",
  },
  {
    n: 8,
    id: "picName",
    title: "NAME(S) PIC",
    note: "Name of the pilot-in-command, or SELF",
  },
  {
    n: 8,
    id: "landings",
    title: "LANDINGS",
    sub: ["day", "night"],
    note: "Number of day / night landings (shown in the name-of-PIC spread; the AMC notes call this column 8)",
  },
  {
    n: 9,
    id: "operationalConditionTime",
    title: "OPERATIONAL CONDITION TIME",
    sub: ["night", "ifr"],
    note: "Night and IFR time",
  },
  {
    n: 10,
    id: "pilotFunctionTime",
    title: "PILOT FUNCTION TIME",
    sub: ["pic", "coPilot", "dual", "instructor"],
    note: "PIC (incl. PICUS/SPIC) / co-pilot / dual / instructor",
  },
  {
    n: 11,
    id: "fstdSession",
    title: "FSTD SESSION",
    sub: ["date", "type", "totalTimeOfSession"],
    note: "Synthetic training: device type and qualification number, date, total time of session",
  },
  {
    n: 12,
    id: "remarks",
    title: "REMARKS AND ENDORSEMENTS",
    note: "Free text, PICUS/SPIC countersignatures, skill test and proficiency check details",
  },
] as const;

// Note on numbering: the AMC1 FCL.050 template and its notes number the columns
// slightly differently between the diagram and the written notes (the notes count
// landings as column 8, the diagram counts name-of-PIC there). The grouping above
// follows the printed template; what matters for compliance is that every
// required field is present, which it is, and the PDF reproduces the template
// layout. The pilot function time sub-columns (PIC / co-pilot / dual / instructor)
// remain a documented part of the layout.

export type LogbookColumnId = (typeof LOGBOOK_COLUMNS)[number]["id"];

/** Columns whose numeric values are summed for page-by-page totals. */
export const SUMMABLE_FIELDS = [
  "singleEngine",
  "multiEngine",
  "multiPilot",
  "total",
  "dayLandings",
  "nightLandings",
  "night",
  "ifr",
  "pic",
  "coPilot",
  "dual",
  "instructor",
  "fstdTotal",
] as const;

export type SummableField = (typeof SUMMABLE_FIELDS)[number];
