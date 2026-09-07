import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, requireWriteCapability, AuthError } from "../../src/http/auth.js";
import { prepareFlightEntry } from "../../src/http/buildEntry.js";
import { RequestError } from "../../src/http/parseEntry.js";
import { createEntry } from "../../src/db/repository.js";
import { getAircraftForFlight } from "../../src/db/referenceRepository.js";
import { parseImportCsv, type DateFormat, type MappedRow } from "../../src/http/importCsv.js";

/**
 * Self-service CSV logbook import for the signed-in holder.
 *
 * This is the in-app counterpart to the token-based Import API (api/import/v1):
 * a pilot migrating an existing logbook uploads the filled-in template
 * (docs/import-template.csv) and every row is mapped to the same entry body the
 * Log-a-flight form posts, then run through the identical prepareFlightEntry
 * pipeline (time conversion, night/landing classification, reference and
 * overlap checks, cross-column validation).
 *
 *   POST /api/import/csv
 *     { csv, timeZone?, dateFormat?, selfName?, commit? }
 *
 * dateFormat ("auto" by default) says how the date column is written; the
 * detected order is returned so the UI can show what was assumed. selfName is
 * the pilot's own name as it appears in the file's PIC column: matching rows
 * are logged as "SELF". Blank aircraft columns (type, engine class, category,
 * multi-pilot) are filled from the registration.
 *
 * commit=false (default) is a dry run: nothing is written, and each row comes
 * back marked "ready" or "error" with the derived total so the pilot can review
 * exactly what will be added before confirming. commit=true writes only the
 * rows that validate; the rest are reported as errors and skipped.
 *
 * Re-running the same file is safe: the overlap guard rejects a flight that
 * clashes with one already stored, so a second import of an already-imported
 * flight comes back as an error ("overlaps an existing entry"), never a
 * duplicate.
 */

const MAX_ROWS = 200;

interface RowResult {
  line: number;
  externalId: string | null;
  date: string;
  route: string;
  aircraft: string;
  function: string;
  status: "ready" | "created" | "error";
  totalMinutes: number | null;
  entryId?: string;
  issues?: Array<{ field: string; message: string }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "Use POST." });
      return;
    }

    const claims = await requireUser(req);
    const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as {
      csv?: unknown;
      timeZone?: unknown;
      dateFormat?: unknown;
      selfName?: unknown;
      commit?: unknown;
    };

    const csv = typeof body.csv === "string" ? body.csv : "";
    if (!csv.trim()) {
      res.status(400).json({ error: "No CSV content was provided." });
      return;
    }
    const timeZone: "UTC" | "LOCAL" = body.timeZone === "LOCAL" ? "LOCAL" : "UTC";
    const dateFormat: DateFormat = ["YMD", "DMY", "MDY", "auto"].includes(body.dateFormat as string)
      ? (body.dateFormat as DateFormat)
      : "auto";
    const selfName = typeof body.selfName === "string" ? body.selfName : null;
    const commit = body.commit === true;

    // A commit writes to the logbook, so it needs write capability. A dry-run
    // preview is a read-only validation and stays open even in read-only state,
    // so a lapsed pilot can still see what an import would do.
    if (commit) await requireWriteCapability(claims.sub);

    const parsed = parseImportCsv(csv, { dateFormat, selfName });
    if (parsed.fatal) {
      res.status(400).json({ error: parsed.fatal });
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      res.status(400).json({
        error: `This file has ${parsed.rows.length} flights. Please split it into files of at most ${MAX_ROWS} rows and import them one at a time.`,
      });
      return;
    }

    const results: RowResult[] = [];
    for (const row of parsed.rows) {
      results.push(await processRow(row, claims.sub, { timeZone, commit }));
    }

    const summary = {
      total: results.length,
      ready: results.filter((r) => r.status === "ready").length,
      created: results.filter((r) => r.status === "created").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    res.status(200).json({ committed: commit, dateFormat: parsed.dateFormat, summary, rows: results });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof RequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/**
 * Fill the aircraft fields the pilot left blank from the reference database.
 * Returns an error issue when the registration is unknown and something is
 * still missing (so we can't proceed), otherwise mutates the entry in place.
 */
async function resolveAircraft(row: MappedRow): Promise<{ field: string; message: string } | null> {
  const ac = row.entry!.aircraft;
  const onDate = row.entry!.legs[0]!.departureTime.slice(0, 10);
  const rec = await getAircraftForFlight(ac.registration, onDate);
  if (!rec) {
    return {
      field: "aircraft.registration",
      message: `${ac.registration} is not in the reference database, so its type and class could not be filled in automatically. Add the aircraft in the app first, or fill the type, engine_class and category columns for this flight.`,
    };
  }
  if (ac.makeModelVariant === "") ac.makeModelVariant = rec.model;
  if (ac.engineClass === "") ac.engineClass = rec.engineCount && rec.engineCount > 1 ? "ME" : "SE";
  if (ac.multiPilot === null) ac.multiPilot = rec.multiPilot ?? false;
  if (ac.category === "") ac.category = rec.category;
  return null;
}

async function processRow(
  row: MappedRow,
  pilotId: string,
  opts: { timeZone: "UTC" | "LOCAL"; commit: boolean },
): Promise<RowResult> {
  const base: RowResult = {
    line: row.line,
    externalId: row.externalId,
    date: row.summary.date,
    route: row.summary.route,
    aircraft: row.summary.aircraft,
    function: row.summary.function,
    status: "error",
    totalMinutes: null,
  };

  // A row that failed the CSV mapping never reaches the DB pipeline.
  if (!row.ok || !row.entry) {
    return { ...base, issues: row.issues ?? [{ field: "row", message: "Row could not be read." }] };
  }

  try {
    if (row.needsAircraftLookup) {
      const miss = await resolveAircraft(row);
      if (miss) return { ...base, issues: [miss] };
      // Reflect the resolved type back into the preview line.
      base.aircraft = [row.entry.aircraft.registration, row.entry.aircraft.makeModelVariant].filter(Boolean).join(" ");
    }

    const entryBody = { ...row.entry, ...(opts.timeZone === "LOCAL" ? { timeZone: "LOCAL" as const } : {}) };
    const prepared = await prepareFlightEntry(entryBody, pilotId);
    if (!prepared.ok) {
      const issues = (prepared.body as { issues?: Array<{ field: string; message: string }> }).issues;
      return { ...base, issues: issues ?? [{ field: "entry", message: "Entry failed validation." }] };
    }

    const total = prepared.derived.total;
    if (!opts.commit) {
      return { ...base, status: "ready", totalMinutes: total };
    }

    const created = await createEntry(
      prepared.input,
      prepared.derived,
      pilotId,
      row.externalId ? `csv-import:${row.externalId}` : "csv-import",
    );
    return { ...base, status: "created", totalMinutes: total, entryId: created.entryId };
  } catch (err) {
    if (err instanceof RequestError) {
      return { ...base, issues: [{ field: "entry", message: err.message }] };
    }
    // An unexpected error on one row must not sink the whole batch.
    const message = err instanceof Error ? err.message : "Unexpected error while importing this row.";
    return { ...base, issues: [{ field: "entry", message }] };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
